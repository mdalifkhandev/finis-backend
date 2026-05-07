import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma/client';
import { ExpenseQueryDto, UpdateExpenseProjectDto } from './dto/expense-management.dto';

@Injectable()
export class ExpenseManagementService {
  constructor(private prisma: PrismaService) {}

  // ─── Access filter ────────────────────────────────────────────────────────
  private getAccessFilter(userId: string, userRole: string) {
    if (userRole === UserRole.super_admin) return {};
    // Admin শুধু নিজের company র expenses দেখবে
    return {
      worker: {
        companyMembers: {
          some: {
            company: { ownerId: userId },
          },
        },
      },
    };
  }

  // ─── IMAGE 1: Stats ───────────────────────────────────────────────────────
  async getStats(userId: string, userRole: string) {
    const accessFilter = this.getAccessFilter(userId, userRole);

    const [pendingCount, approvedCount, rejectedCount, pendingAmount] =
      await Promise.all([
        this.prisma.expense.count({
          where: { ...accessFilter, status: 'pending' },
        }),
        this.prisma.expense.count({
          where: { ...accessFilter, status: 'approved' },
        }),
        this.prisma.expense.count({
          where: { ...accessFilter, status: 'rejected' },
        }),
        this.prisma.expense.aggregate({
          where: { ...accessFilter, status: 'pending' },
          _sum: { amount: true },
        }),
      ]);

    return {
      pendingApproval: pendingCount,
      pendingAmount:   Math.round((pendingAmount._sum.amount ?? 0) * 100) / 100,
      approved:        approvedCount,
      rejected:        rejectedCount,
    };
  }

  // ─── IMAGE 1: Expense List ────────────────────────────────────────────────
  async getExpenses(
    userId: string,
    userRole: string,
    query: ExpenseQueryDto,
  ) {
    const { status, search, category, projectId, month, year } = query;
    const accessFilter = this.getAccessFilter(userId, userRole);

    const now = new Date();
    const m   = month ? parseInt(month) - 1 : null;
    const y   = year  ? parseInt(year)      : now.getFullYear();

    const dateFilter = m !== null
      ? {
          date: {
            gte: new Date(y, m, 1),
            lte: new Date(y, m + 1, 0),
          },
        }
      : {};

    const expenses = await this.prisma.expense.findMany({
      where: {
        ...accessFilter,
        ...(status    && { status: status as any }),
        ...(category  && { category: category as any }),
        ...(projectId && { projectId }),
        ...dateFilter,
        ...(search && {
          OR: [
            {
              worker: {
                fullName: { contains: search, mode: 'insensitive' },
              },
            },
            {
              description: { contains: search, mode: 'insensitive' },
            },
          ],
        }),
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: expenses.length,
      expenses: expenses.map((e) => ({
        id:          e.id,
        worker:      e.worker,
        description: e.description,
        category:    e.category,
        amount:      e.amount,
        project:     e.project,
        date:        e.date,
        status:      e.status,
        receiptUrl:  e.receiptUrl,
      })),
    };
  }

  // ─── IMAGE 2: Expense Detail ──────────────────────────────────────────────
  async getExpenseDetail(
    expenseId: string,
    userId: string,
    userRole: string,
  ) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
            department: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!expense) throw new NotFoundException('Expense not found');

    // Project এর tasks আনো (Linked Task dropdown এর জন্য)
    const tasks = expense.projectId
      ? await this.prisma.task.findMany({
          where:  { projectId: expense.projectId },
          select: { id: true, title: true, status: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return {
      id:          expense.id,
      receiptUrl:  expense.receiptUrl,
      worker:      expense.worker,
      amount:      expense.amount,
      category:    expense.category,
      date:        expense.date,
      description: expense.description,
      project:     expense.project,
      availableTasks: tasks,
      status:      expense.status,
      reviewNotes: expense.reviewNotes,
      reviewedAt:  expense.reviewedAt,
    };
  }

  // ─── Approve / Reject ─────────────────────────────────────────────────────
  async reviewExpense(
    expenseId: string,
    action: 'approved' | 'rejected',
    userId: string,
    userRole: string,
    reviewNotes?: string,
  ) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.status !== 'pending') {
      throw new BadRequestException('Only pending expenses can be reviewed');
    }

    return this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status:      action,
        reviewedBy:  userId,
        reviewedAt:  new Date(),
        ...(reviewNotes && { reviewNotes }),
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  // ─── Update Project & Task ────────────────────────────────────────────────
  async updateExpenseProject(
    expenseId: string,
    dto: UpdateExpenseProjectDto,
    userId: string,
    userRole: string,
  ) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
    });
    if (!expense) throw new NotFoundException('Expense not found');

    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });
      if (!project) throw new NotFoundException('Project not found');
    }

    return this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
      },
      include: {
        worker:  { select: { id: true, fullName: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Export Report ────────────────────────────────────────────────────────
  async exportReport(
    userId: string,
    userRole: string,
    query: ExpenseQueryDto,
  ) {
    const { expenses } = await this.getExpenses(userId, userRole, query);

    const totalAmount    = expenses.reduce((s, e) => s + e.amount, 0);
    const approvedAmount = expenses
      .filter((e) => e.status === 'approved')
      .reduce((s, e) => s + e.amount, 0);
    const pendingAmount  = expenses
      .filter((e) => e.status === 'pending')
      .reduce((s, e) => s + e.amount, 0);
    const rejectedAmount = expenses
      .filter((e) => e.status === 'rejected')
      .reduce((s, e) => s + e.amount, 0);

    return {
      generatedAt:     new Date(),
      summary: {
        total:          expenses.length,
        totalAmount:    Math.round(totalAmount    * 100) / 100,
        approvedAmount: Math.round(approvedAmount * 100) / 100,
        pendingAmount:  Math.round(pendingAmount  * 100) / 100,
        rejectedAmount: Math.round(rejectedAmount * 100) / 100,
      },
      expenses,
    };
  }
}