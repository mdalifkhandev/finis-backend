import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReimbursementExpenseStatus, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReimbursementExpenseDto, ReimbursementExpenseFilterDto, RejectReimbursementExpenseDto, UpdateReimbursementExpenseDto, REIMBURSEMENT_EXPENSE_CATEGORIES, REIMBURSEMENT_EXPENSE_CURRENCIES, REIMBURSEMENT_PAYMENT_METHODS } from './dto/reimbursement-expense.dto';

@Injectable()
export class ReimbursementExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdminReviewer(role: string) {
    return role === UserRole.admin || role === UserRole.super_admin;
  }

  private isManager(role: string) {
    return role === UserRole.manager;
  }

  private assertExpenseAccess(role: string) {
    if (!this.isAdminReviewer(role) && !this.isManager(role) && role !== UserRole.worker) throw new ForbiddenException('Expense access required');
  }

  private assertCreateAccess(role: string) {
    if (!this.isAdminReviewer(role) && !this.isManager(role) && role !== UserRole.worker) throw new ForbiddenException('Only workers, managers, or admins can create expenses');
  }

  private assertAdminReviewer(role: string) {
    if (!this.isAdminReviewer(role)) throw new ForbiddenException('Admin access required');
  }

  private async getManagedWorkerIds(managerId: string) {
    const [mappedWorkers, directlyManagedMembers, managerProjects] = await Promise.all([
      this.prisma.workerManagerMap.findMany({ where: { managerId }, select: { workerId: true } }),
      this.prisma.projectMember.findMany({ where: { managerId, role: 'worker' }, select: { userId: true } }),
      this.prisma.projectMember.findMany({ where: { userId: managerId, role: 'manager' }, select: { projectId: true } }),
    ]);
    const projectIds = managerProjects.map((member) => member.projectId);
    const projectWorkers = projectIds.length
      ? await this.prisma.projectMember.findMany({ where: { projectId: { in: projectIds }, role: 'worker' }, select: { userId: true } })
      : [];
    return [...new Set([
      ...mappedWorkers.map((row) => row.workerId),
      ...directlyManagedMembers.map((member) => member.userId),
      ...projectWorkers.map((member) => member.userId),
    ])];
  }

  private async buildScopedWhere(userId: string, role: string): Promise<Prisma.ReimbursementExpenseWhereInput> {
    if (this.isAdminReviewer(role)) return {};
    if (this.isManager(role)) return { createdById: { in: [userId, ...(await this.getManagedWorkerIds(userId))] } };
    return { createdById: userId };
  }

  private async assertProject(projectId?: string) {
    if (!projectId) return;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new BadRequestException('Invalid project ID');
  }

  private async assertProjectAccess(userId: string, role: string, projectId?: string) {
    if (!projectId || this.isAdminReviewer(role)) return;
    const membership = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
        role: this.isManager(role) ? 'manager' : 'worker',
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('You can only create expenses for assigned projects');
  }

  private toMoney(value: number) {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private serialize(expense: any) {
    return expense ? { ...expense, amount: Number(expense.amount) } : expense;
  }

  private normalizeOption(value?: string | null) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  private mergeOptions(defaults: readonly string[], values: Array<string | null>) {
    const map = new Map<string, string>();
    [...defaults, ...values].forEach((value) => {
      const option = this.normalizeOption(value);
      if (!option) return;
      const key = option.toLowerCase();
      if (!map.has(key)) map.set(key, option);
    });
    return [...map.values()];
  }

  private async getExpenseOrThrow(id: string, userId: string, role: string) {
    this.assertExpenseAccess(role);
    const expense = await this.prisma.reimbursementExpense.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true, email: true } } },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (this.isAdminReviewer(role)) return expense;
    if (this.isManager(role)) {
      if (expense.createdById === userId) return expense;
      const workerIds = await this.getManagedWorkerIds(userId);
      if (!workerIds.includes(expense.createdById)) throw new ForbiddenException('You can only access your own expenses or expenses from your assigned workers');
      return expense;
    }
    if (expense.createdById !== userId) throw new ForbiddenException('You can only access your own expenses');
    return expense;
  }

  async findAll(adminId: string, role: string, query: ReimbursementExpenseFilterDto) {
    this.assertExpenseAccess(role);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: Prisma.ReimbursementExpenseWhereInput = {
      ...(await this.buildScopedWhere(adminId, role)),
      ...(query.status ? { status: query.status as ReimbursementExpenseStatus } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.startDate || query.endDate ? { expenseDate: { ...(query.startDate ? { gte: new Date(query.startDate) } : {}), ...(query.endDate ? { lte: new Date(query.endDate) } : {}) } } : {}),
      ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { vendor: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.reimbursementExpense.findMany({ where, include: { project: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true, email: true } } }, orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.reimbursementExpense.count({ where }),
    ]);
    return { data: items.map((e) => this.serialize(e)), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getProjects(userId: string, role: string) {
    this.assertExpenseAccess(role);
    if (this.isAdminReviewer(role)) {
      return this.prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    }
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId, role: this.isManager(role) ? 'manager' : 'worker' },
      select: { project: { select: { id: true, name: true } } },
      orderBy: { project: { name: 'asc' } },
    });
    return memberships.map((member) => member.project);
  }

  async getOptions(adminId: string, role: string) {
    this.assertExpenseAccess(role);
    const [currencies, categories, paymentMethods] = await Promise.all([
      this.prisma.reimbursementExpense.findMany({ distinct: ['currency'], select: { currency: true }, orderBy: { currency: 'asc' } }),
      this.prisma.reimbursementExpense.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
      this.prisma.reimbursementExpense.findMany({ where: { paymentMethod: { not: null } }, distinct: ['paymentMethod'], select: { paymentMethod: true }, orderBy: { paymentMethod: 'asc' } }),
    ]);

    return {
      currency: this.mergeOptions(REIMBURSEMENT_EXPENSE_CURRENCIES, currencies.map((item) => item.currency)),
      category: this.mergeOptions(REIMBURSEMENT_EXPENSE_CATEGORIES, categories.map((item) => item.category)),
      paymentMethod: this.mergeOptions(REIMBURSEMENT_PAYMENT_METHODS, paymentMethods.map((item) => item.paymentMethod)),
    };
  }

  async getSummary(adminId: string, role: string) {
    this.assertExpenseAccess(role);
    const scopeWhere = await this.buildScopedWhere(adminId, role);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const [totalExpenses, draft, submitted, approved, rejected, paid, monthly] = await Promise.all([
      this.prisma.reimbursementExpense.count({ where: scopeWhere }),
      this.prisma.reimbursementExpense.count({ where: { ...scopeWhere, status: 'DRAFT' } }),
      this.prisma.reimbursementExpense.count({ where: { ...scopeWhere, status: 'SUBMITTED' } }),
      this.prisma.reimbursementExpense.count({ where: { ...scopeWhere, status: 'APPROVED' } }),
      this.prisma.reimbursementExpense.count({ where: { ...scopeWhere, status: 'REJECTED' } }),
      this.prisma.reimbursementExpense.count({ where: { ...scopeWhere, status: 'PAID' } }),
      this.prisma.reimbursementExpense.aggregate({ where: { ...scopeWhere, expenseDate: { gte: start, lte: end } }, _sum: { amount: true } }),
    ]);
    return { summary: { totalExpenses, draft, submitted, approved, rejected, paid, totalAmountThisMonth: Number(monthly._sum.amount ?? 0) } };
  }

  async findOne(id: string, adminId: string, role: string) { return this.serialize(await this.getExpenseOrThrow(id, adminId, role)); }

  async create(dto: CreateReimbursementExpenseDto, adminId: string, role: string) {
    this.assertCreateAccess(role); if (!dto.projectId) throw new BadRequestException('Project is required'); await this.assertProject(dto.projectId); await this.assertProjectAccess(adminId, role, dto.projectId); this.assertNotFuture(dto.expenseDate);
    const status = dto.action === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
    const expense = await this.prisma.reimbursementExpense.create({ data: { title: dto.title, expenseDate: new Date(dto.expenseDate), amount: this.toMoney(dto.amount), currency: this.normalizeOption(dto.currency) || 'BDT', category: this.normalizeOption(dto.category), vendor: dto.vendor || null, paymentMethod: this.normalizeOption(dto.paymentMethod) || null, projectId: dto.projectId || null, taskId: dto.taskId || null, notes: dto.notes || null, receiptUrl: dto.receiptUrl || null, createdById: adminId, status, submittedAt: status === 'SUBMITTED' ? new Date() : null }, include: { project: { select: { id: true, name: true } } } });
    return { message: status === 'SUBMITTED' ? 'Expense submitted successfully' : 'Expense draft saved successfully', ...this.serialize(expense) };
  }

  async update(id: string, dto: UpdateReimbursementExpenseDto, adminId: string, role: string) {
    const existing = await this.getExpenseOrThrow(id, adminId, role);
    if (this.isManager(role) && existing.createdById !== adminId) throw new ForbiddenException('Managers can only edit their own expenses'); if (!['DRAFT', 'SUBMITTED', 'REJECTED'].includes(existing.status)) throw new BadRequestException('Only draft, submitted, or rejected expenses can be updated');
    await this.assertProject(dto.projectId); await this.assertProjectAccess(adminId, role, dto.projectId); if (dto.expenseDate) this.assertNotFuture(dto.expenseDate);
    const expense = await this.prisma.reimbursementExpense.update({ where: { id }, data: { ...(dto.title !== undefined ? { title: dto.title } : {}), ...(dto.expenseDate ? { expenseDate: new Date(dto.expenseDate) } : {}), ...(dto.amount !== undefined ? { amount: this.toMoney(dto.amount) } : {}), ...(dto.currency ? { currency: this.normalizeOption(dto.currency) } : {}), ...(dto.category ? { category: this.normalizeOption(dto.category) } : {}), ...(dto.vendor !== undefined ? { vendor: dto.vendor || null } : {}), ...(dto.paymentMethod !== undefined ? { paymentMethod: this.normalizeOption(dto.paymentMethod) || null } : {}), ...(dto.projectId !== undefined ? { projectId: dto.projectId || null } : {}), ...(dto.taskId !== undefined ? { taskId: dto.taskId || null } : {}), ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}), ...(dto.receiptUrl !== undefined ? { receiptUrl: dto.receiptUrl || null } : {}) }, include: { project: { select: { id: true, name: true } } } });
    return { message: 'Expense updated successfully', ...this.serialize(expense) };
  }

  async remove(id: string, adminId: string, role: string) { const existing = await this.getExpenseOrThrow(id, adminId, role); if (this.isManager(role) && existing.createdById !== adminId) throw new ForbiddenException('Managers can only delete their own expenses'); if (existing.status !== 'DRAFT') throw new BadRequestException('Only draft expenses can be deleted'); await this.prisma.reimbursementExpense.delete({ where: { id } }); return { message: 'Expense deleted successfully', id }; }
  async submit(id: string, adminId: string, role: string) { const existing = await this.getExpenseOrThrow(id, adminId, role); if (this.isManager(role) && existing.createdById !== adminId) throw new ForbiddenException('Managers can only submit their own expenses'); return this.transition(id, adminId, role, 'DRAFT', { status: 'SUBMITTED', submittedAt: new Date() }, 'Expense submitted successfully'); }
  async approve(id: string, adminId: string, role: string) { this.assertExpenseAccess(role); if (role === UserRole.worker) throw new ForbiddenException('Workers cannot approve expenses'); const existing = await this.getExpenseOrThrow(id, adminId, role); if (this.isManager(role) && existing.createdById === adminId) throw new ForbiddenException('Managers cannot approve their own expenses'); return this.transition(id, adminId, role, 'SUBMITTED', { status: 'APPROVED', approvedAt: new Date() }, 'Expense approved successfully'); }
  async reject(id: string, dto: RejectReimbursementExpenseDto, adminId: string, role: string) { this.assertExpenseAccess(role); if (role === UserRole.worker) throw new ForbiddenException('Workers cannot reject expenses'); const existing = await this.getExpenseOrThrow(id, adminId, role); if (this.isManager(role) && existing.createdById === adminId) throw new ForbiddenException('Managers cannot reject their own expenses'); return this.transition(id, adminId, role, 'SUBMITTED', { status: 'REJECTED', rejectedAt: new Date(), rejectionNote: dto.comment || null }, 'Expense rejected successfully'); }
  async markPaid(id: string, adminId: string, role: string) { this.assertAdminReviewer(role); return this.transition(id, adminId, role, 'APPROVED', { status: 'PAID', paidAt: new Date() }, 'Expense marked as paid successfully'); }

  private async transition(id: string, userId: string, role: string, from: ReimbursementExpenseStatus, data: Prisma.ReimbursementExpenseUpdateInput, message: string) {
    const existing = await this.getExpenseOrThrow(id, userId, role); if (existing.status !== from) throw new BadRequestException(`Only ${from} expenses can use this action`);
    const expense = await this.prisma.reimbursementExpense.update({ where: { id }, data, include: { project: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true, email: true } } } });
    return { message, ...this.serialize(expense) };
  }

  private assertNotFuture(value: string) {
    const date = new Date(value); const today = new Date(); today.setHours(23, 59, 59, 999);
    if (date.getTime() > today.getTime()) throw new BadRequestException('Future expense dates are not allowed');
  }
}
