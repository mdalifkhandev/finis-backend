import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma/client';
import {
  CreatePayrollDto,
  ApprovePayrollDto,
  UpdatePayrollDto,
} from './dto/payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async getAccessibleCompanyIds(adminId: string, userRole: string) {
    if (userRole === UserRole.super_admin) {
      const companies = await this.prisma.company.findMany({
        select: { id: true },
      });
      return companies.map((c) => c.id);
    }
    const companies = await this.prisma.company.findMany({
      where: { ownerId: adminId, isActive: true },
      select: { id: true },
    });
    return companies.map((c) => c.id);
  }

  /**
   * Selected date-এর attendance sessions থেকে total worked hours বের করো।
   * প্রতিটা checkIn-checkOut pair এর duration যোগ করে।
   * চলমান (checkOut নেই) session বাদ দেওয়া হবে।
   */
  private async getWorkedHoursForDate(
    workerId: string,
    date: Date,
  ): Promise<{
    totalHours: number;
    totalMinutes: number;
    displayTime: string; // "2h 30m" format
    sessions: Array<{
      checkInTime: Date;
      checkOutTime: Date | null;
      durationMinutes: number;
    }>;
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const attendance = await this.prisma.attendance.findFirst({
      where: {
        userId: workerId,
        date: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        sessions: {
          orderBy: { checkInTime: 'asc' },
        },
      },
    });

    if (!attendance || !attendance.sessions?.length) {
      return {
        totalHours: 0,
        totalMinutes: 0,
        displayTime: '0h 0m',
        sessions: [],
      };
    }

    let totalMinutes = 0;
    const sessionDetails: Array<{
      checkInTime: Date;
      checkOutTime: Date | null;
      durationMinutes: number;
    }> = [];

    for (const session of attendance.sessions) {
      if (!session.checkOutTime) {
        // চলমান session — বাদ দাও
        sessionDetails.push({
          checkInTime: session.checkInTime,
          checkOutTime: null,
          durationMinutes: 0,
        });
        continue;
      }

      const diffMs =
        session.checkOutTime.getTime() - session.checkInTime.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      totalMinutes += diffMinutes;

      sessionDetails.push({
        checkInTime: session.checkInTime,
        checkOutTime: session.checkOutTime,
        durationMinutes: diffMinutes,
      });
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

    return {
      totalHours,
      totalMinutes,
      displayTime: `${hours}h ${minutes}m`,
      sessions: sessionDetails,
    };
  }

  private getEffectiveRate(
    user: { hourlyRate: number | null },
    payroll?: { ratePerHour: number } | null,
  ) {
    return payroll?.ratePerHour ?? user.hourlyRate ?? 0;
  }

  private getDefaultConfig() {
    return {
      cppEmployeeRate: 0.0595,
      eiEmployeeRate: 0.0166,
      federalTaxRate: 0.15,
      provincialTaxRate: 0.0505,
      cppEmployerRate: 0.0595,
      eiEmployerRate: 0.0232,
      wsibRate: 0.0142,
      vacationPayRate: 0.04,
    };
  }

  private calculatePayrollFields(
    regularHours: number,
    overtimeHours: number,
    ratePerHour: number,
    config: {
      cppEmployeeRate: number;
      eiEmployeeRate: number;
      federalTaxRate: number;
      provincialTaxRate: number;
      cppEmployerRate: number;
      eiEmployerRate: number;
      wsibRate: number;
      vacationPayRate: number;
    },
    overrideDeductions?: number,
  ) {
    const regularPay = regularHours * ratePerHour;
    const overtimePay = overtimeHours * ratePerHour * 1.5;
    const grossPay = Math.round((regularPay + overtimePay) * 100) / 100;

    const cppEmployee = Math.round(grossPay * config.cppEmployeeRate * 100) / 100;
    const eiEmployee = Math.round(grossPay * config.eiEmployeeRate * 100) / 100;
    const federalTax = Math.round(grossPay * config.federalTaxRate * 100) / 100;
    const provincialTax = Math.round(grossPay * config.provincialTaxRate * 100) / 100;
    const computedDeductions =
      Math.round((cppEmployee + eiEmployee + federalTax + provincialTax) * 100) / 100;
    const deductions = overrideDeductions ?? computedDeductions;
    const netPay = Math.round((grossPay - deductions) * 100) / 100;

    const cppEmployer = Math.round(grossPay * config.cppEmployerRate * 100) / 100;
    const eiEmployer = Math.round(grossPay * config.eiEmployerRate * 100) / 100;
    const wsib = Math.round(grossPay * config.wsibRate * 100) / 100;
    const vacationPay = Math.round(grossPay * config.vacationPayRate * 100) / 100;
    const employerCost =
      Math.round((grossPay + cppEmployer + eiEmployer + wsib + vacationPay) * 100) / 100;

    return {
      grossPay,
      deductions,
      netPay,
      employerCost,
      breakdown: {
        cppEmployee,
        eiEmployee,
        federalTax,
        provincialTax,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET PAYROLL USERS — selected date-এর attendance থেকে hours
  // ─────────────────────────────────────────────────────────────────────────
  async getPayrollUsers(adminId: string, userRole: string, date?: string) {
    const accessibleCompanyIds = await this.getAccessibleCompanyIds(adminId, userRole);

    // Selected date অথবা আজকের date
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    // সেই date-এ present ছিল এমন সব workers
    const projectMembers = await this.prisma.projectMember.findMany({
      where: {
        role: 'worker',
        ...(accessibleCompanyIds.length > 0
          ? { project: { companyId: { in: accessibleCompanyIds } } }
          : { project: { company: { ownerId: adminId } } }),
      },
      distinct: ['userId'],
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            role: true,
            status: true,
            department: true,
            employeeId: true,
            hourlyRate: true,
            joinDate: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // user map বানাও — duplicate userId এড়াতে
    const userMap = new Map<
      string,
      {
        user: any;
        projects: Array<{ id: string; name: string; companyId: string }>;
      }
    >();

    for (const member of projectMembers) {
      const existing = userMap.get(member.userId);
      if (existing) {
        const alreadyAdded = existing.projects.some((p) => p.id === member.project.id);
        if (!alreadyAdded) existing.projects.push(member.project);
      } else {
        userMap.set(member.userId, {
          user: member.user,
          projects: [member.project],
        });
      }
    }

    const users = await Promise.all(
      [...userMap.entries()].map(async ([userId, entry]) => {
        // Selected date-এ attendance আছে কিনা চেক করো
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const attendanceOnDate = await this.prisma.attendance.findFirst({
          where: {
            userId,
            date: { gte: startOfDay, lte: endOfDay },
          },
          include: {
            sessions: { orderBy: { checkInTime: 'asc' } },
          },
        });

        // Present না হলে skip
        if (!attendanceOnDate || attendanceOnDate.status !== 'present') {
          return null;
        }

        // Geofencing sessions থেকে actual worked hours বের করো
        const workedData = await this.getWorkedHoursForDate(userId, targetDate);

        // Latest payroll দেখো rate-এর জন্য
        const latestPayroll = await this.prisma.payroll.findFirst({
          where: {
            workerId: userId,
            ...(accessibleCompanyIds.length > 0
              ? { companyId: { in: accessibleCompanyIds } }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            regularHours: true,
            overtimeHours: true,
            ratePerHour: true,
            grossPay: true,
            deductions: true,
            netPay: true,
            status: true,
            payPeriodStart: true,
            payPeriodEnd: true,
            processedAt: true,
          },
        });

        const effectiveRate = this.getEffectiveRate(entry.user, latestPayroll);

        // Payroll preview calculate
        const preview = this.calculatePayrollFields(
          workedData.totalHours,
          0,
          effectiveRate,
          this.getDefaultConfig(),
        );

        return {
          user: entry.user,
          projects: entry.projects,
          attendance: {
            date: targetDate,
            status: attendanceOnDate.status,
            // checkIn/checkOut sessions
            sessions: workedData.sessions.map((s) => ({
              checkInTime: s.checkInTime,
              checkOutTime: s.checkOutTime,
              duration: this.formatMinutes(s.durationMinutes),
            })),
            // Total worked time
            totalWorked: {
              hours: workedData.totalHours,
              minutes: workedData.totalMinutes,
              display: workedData.displayTime, // "2h 30m"
            },
          },
          payrollPreview: {
            regularHours: workedData.totalHours,
            displayHours: workedData.displayTime,
            overtimeHours: 0,
            ratePerHour: effectiveRate,
            grossPay: preview.grossPay,
            deductions: preview.deductions,
            netPay: preview.netPay,
            employerCost: preview.employerCost,
          },
          latestPayroll,
        };
      }),
    );

    const filteredUsers = users.filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );

    return {
      date: targetDate,
      totalUsers: filteredUsers.length,
      users: filteredUsers,
    };
  }

  // minutes কে "Xh Ym" format-এ দেখাও
  private formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. CREATE PAYROLL — geofencing attendance থেকে auto hours
  // ─────────────────────────────────────────────────────────────────────────
  async createPayroll(dto: CreatePayrollDto, adminId: string, userRole: string) {
    const worker = await this.prisma.user.findUnique({
      where: { id: dto.workerId },
    });
    if (!worker) throw new NotFoundException('Worker not found');
    if (worker.role !== UserRole.worker) {
      throw new BadRequestException('User is not a worker');
    }

    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });
      if (!project) throw new NotFoundException('Project not found');

      const isMember = await this.prisma.projectMember.findFirst({
        where: { projectId: dto.projectId, userId: dto.workerId },
      });
      if (!isMember) {
        throw new BadRequestException('Worker is not a member of this project');
      }
    }

    // Config থেকে rates নাও
    const config = await this.prisma.payrollConfig.findUnique({
      where: { companyId: dto.companyId },
    });

    const configRates = {
      cppEmployeeRate: config?.cppEmployeeRate ?? 0.0595,
      eiEmployeeRate: config?.eiEmployeeRate ?? 0.0166,
      federalTaxRate: config?.federalTaxRate ?? 0.15,
      provincialTaxRate: config?.provincialTaxRate ?? 0.0505,
      cppEmployerRate: config?.cppEmployerRate ?? 0.0595,
      eiEmployerRate: config?.eiEmployerRate ?? 0.0232,
      wsibRate: config?.wsibRate ?? 0.0142,
      vacationPayRate: config?.vacationPayRate ?? 0.04,
    };

    // payPeriodStart date-এর attendance sessions থেকে hours বের করো
    const targetDate = new Date(dto.payPeriodStart);
    const workedData = await this.getWorkedHoursForDate(dto.workerId, targetDate);

    const regularHours = workedData.totalHours;
    const overtimeHours = 0;

    const computed = this.calculatePayrollFields(
      regularHours,
      overtimeHours,
      dto.ratePerHour,
      configRates,
    );

    return this.prisma.payroll.create({
      data: {
        companyId: dto.companyId,
        workerId: dto.workerId,
        ...(dto.projectId && { projectId: dto.projectId }),
        payPeriodStart: new Date(dto.payPeriodStart),
        payPeriodEnd: new Date(dto.payPeriodEnd),
        regularHours,
        overtimeHours,
        ratePerHour: dto.ratePerHour,
        grossPay: computed.grossPay,
        deductions: computed.deductions,
        netPay: computed.netPay,
        employerCost: computed.employerCost,
        status: 'draft',
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: true,
            hourlyRate: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. PAYROLL SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  async getPayrollSummary(
    adminId: string,
    userRole: string,
    month?: string,
    year?: string,
    projectId?: string,
  ) {
    const now = new Date();
    const m = month ? parseInt(month) - 1 : now.getMonth();
    const y = year ? parseInt(year) : now.getFullYear();

    const startDate = new Date(y, m, 1);
    const endDate = new Date(y, m + 1, 0);

    const payrolls = await this.prisma.payroll.findMany({
      where: {
        payPeriodStart: { gte: startDate },
        payPeriodEnd: { lte: endDate },
        ...(projectId && { projectId }),
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: true,
            hourlyRate: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalHours = payrolls.reduce(
      (s, p) => s + p.regularHours + p.overtimeHours,
      0,
    );
    const totalPay = payrolls.reduce((s, p) => s + p.grossPay, 0);
    const pending = payrolls.filter((p) => p.status === 'draft').length;
    const processing = payrolls.filter((p) => p.status === 'approved').length;
    const paid = payrolls.filter((p) => p.status === 'paid').length;

    const inventoryAlerts = await this.prisma.inventoryItem.count({
      where: {
        currentQty: { lte: 0 },
        ...(projectId && { projectId }),
      },
    });

    return {
      summary: {
        totalHours: Math.round(totalHours * 100) / 100,
        totalHoursDisplay: this.formatMinutes(Math.floor(totalHours * 60)),
        totalPay: Math.round(totalPay * 100) / 100,
        pending,
        processing,
        paid,
        inventoryAlerts,
      },
      workers: payrolls.map((p) => ({
        payrollId: p.id,
        project: p.project,
        worker: p.worker,
        hours: p.regularHours,
        hoursDisplay: this.formatMinutes(Math.floor(p.regularHours * 60)),
        overtimeHours: p.overtimeHours,
        rate: p.ratePerHour,
        grossPay: p.grossPay,
        deductions: p.deductions,
        netPay: p.netPay,
        status: p.status,
        payPeriodStart: p.payPeriodStart,
        payPeriodEnd: p.payPeriodEnd,
        processedAt: p.processedAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. UPDATE PAYROLL (admin edit করতে পারবে)
  // ─────────────────────────────────────────────────────────────────────────
  async updatePayroll(
    payrollId: string,
    adminId: string,
    userRole: string,
    dto: UpdatePayrollDto,
  ) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status === 'paid') {
      throw new BadRequestException('Paid payroll cannot be edited');
    }

    const config = await this.prisma.payrollConfig.findUnique({
      where: { companyId: payroll.companyId },
    });

    const updatedRegularHours = dto.regularHours ?? payroll.regularHours;
    const updatedOvertimeHours = dto.overtimeHours ?? payroll.overtimeHours;
    const updatedRatePerHour = dto.ratePerHour ?? payroll.ratePerHour;

    const computed = this.calculatePayrollFields(
      updatedRegularHours,
      updatedOvertimeHours,
      updatedRatePerHour,
      {
        cppEmployeeRate: config?.cppEmployeeRate ?? 0.0595,
        eiEmployeeRate: config?.eiEmployeeRate ?? 0.0166,
        federalTaxRate: config?.federalTaxRate ?? 0.15,
        provincialTaxRate: config?.provincialTaxRate ?? 0.0505,
        cppEmployerRate: config?.cppEmployerRate ?? 0.0595,
        eiEmployerRate: config?.eiEmployerRate ?? 0.0232,
        wsibRate: config?.wsibRate ?? 0.0142,
        vacationPayRate: config?.vacationPayRate ?? 0.04,
      },
      dto.deductions,
    );

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        regularHours: updatedRegularHours,
        overtimeHours: updatedOvertimeHours,
        ratePerHour: updatedRatePerHour,
        grossPay: computed.grossPay,
        deductions: computed.deductions,
        netPay: computed.netPay,
        employerCost: computed.employerCost,
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PAY STUB
  // ─────────────────────────────────────────────────────────────────────────
  async getPayStub(payrollId: string, userId: string, userRole: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            department: true,
            hourlyRate: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    if (!payroll) throw new NotFoundException('Payroll not found');

    if (userRole === UserRole.worker && payroll.workerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const regularPay =
      Math.round(payroll.regularHours * payroll.ratePerHour * 100) / 100;
    const overtimePay =
      Math.round(payroll.overtimeHours * payroll.ratePerHour * 1.5 * 100) / 100;

    return {
      payrollId: payroll.id,
      worker: payroll.worker,
      project: payroll.project,
      payPeriod: {
        start: payroll.payPeriodStart,
        end: payroll.payPeriodEnd,
      },
      earnings: {
        regularHours: payroll.regularHours,
        regularHoursDisplay: this.formatMinutes(
          Math.floor(payroll.regularHours * 60),
        ),
        regularPay,
        overtimeHours: payroll.overtimeHours,
        overtimeHoursDisplay: this.formatMinutes(
          Math.floor(payroll.overtimeHours * 60),
        ),
        overtimePay,
        grossPay: payroll.grossPay,
      },
      deductions: {
        totalDeductions: payroll.deductions,
      },
      netPay: payroll.netPay,
      employerCost: payroll.employerCost,
      status: payroll.status,
      processedAt: payroll.processedAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. APPROVE PAYROLL — draft → approved
  // ─────────────────────────────────────────────────────────────────────────
  async approvePayroll(
    payrollId: string,
    adminId: string,
    userRole: string,
    dto: ApprovePayrollDto,
  ) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status !== 'draft') {
      throw new BadRequestException('Only draft payrolls can be approved');
    }

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'approved',
        processedBy: adminId,
        processedAt: new Date(),
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. MARK AS PAID — approved → paid (manual, status update only)
  // ─────────────────────────────────────────────────────────────────────────
  async markPayrollPaid(
    payrollId: string,
    adminId: string,
    userRole: string,
    note?: string,
  ) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status === 'paid') {
      throw new BadRequestException('Payroll is already marked as paid');
    }
    if (payroll.status !== 'approved') {
      throw new BadRequestException(
        'Only approved payrolls can be marked as paid',
      );
    }

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'paid',
        processedBy: adminId,
        processedAt: new Date(),
      },
      include: {
        worker: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: true,
          },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. PROCESS PAYROLL — approved payrolls-এর summary
  // ─────────────────────────────────────────────────────────────────────────
  async processPayroll(
    adminId: string,
    userRole: string,
    month?: string,
    year?: string,
    projectId?: string,
  ) {
    const now = new Date();
    const m = month ? parseInt(month) - 1 : now.getMonth();
    const y = year ? parseInt(year) : now.getFullYear();

    const startDate = new Date(y, m, 1);
    const endDate = new Date(y, m + 1, 0);

    const payrolls = await this.prisma.payroll.findMany({
      where: {
        status: 'approved',
        payPeriodStart: { gte: startDate },
        payPeriodEnd: { lte: endDate },
        ...(projectId && { projectId }),
      },
      include: {
        worker: {
          select: { id: true, fullName: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    if (payrolls.length === 0) {
      throw new BadRequestException(
        'No approved payrolls found for this period',
      );
    }

    const results = payrolls.map((payroll) => ({
      payrollId: payroll.id,
      workerId: payroll.worker.id,
      workerName: payroll.worker.fullName,
      projectId: payroll.projectId ?? undefined,
      projectName: payroll.project?.name,
      regularHours: payroll.regularHours,
      hoursDisplay: this.formatMinutes(Math.floor(payroll.regularHours * 60)),
      grossPay: payroll.grossPay,
      deductions: payroll.deductions,
      netPay: payroll.netPay,
      status: 'processing' as const,
    }));

    const totalGrossPay = results.reduce((sum, item) => sum + item.grossPay, 0);
    const totalDeductions = results.reduce((sum, item) => sum + item.deductions, 0);
    const totalNetPay = results.reduce((sum, item) => sum + item.netPay, 0);

    return {
      message: `Payroll processing started for ${results.length} record(s)`,
      summary: {
        totalPayrolls: results.length,
        totalGrossPay: Math.round(totalGrossPay * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        totalNetPay: Math.round(totalNetPay * 100) / 100,
      },
      results,
    };
  }
}