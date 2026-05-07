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
} from './dto/payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) { }

  private async getWorkedHoursForPeriod(
    workerId: string,
    payPeriodStart: string,
    payPeriodEnd: string,
  ) {
    const startDate = new Date(payPeriodStart);
    const endDate = new Date(payPeriodEnd);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        userId: workerId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        totalHours: true,
      },
    });

    return Math.round(
      attendances.reduce((sum, attendance) => sum + (attendance.totalHours ?? 0), 0) * 100,
    ) / 100;
  }

  // ─── Create Payroll ───────────────────────────────────────────────────────
  async createPayroll(
    dto: CreatePayrollDto,
    adminId: string,
    userRole: string,
  ) {
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

    // ─── Config থেকে calculation ──────────────────────────────────────────
    const config = await this.prisma.payrollConfig.findUnique({
      where: { companyId: dto.companyId },
    });

    // Config না থাকলে default values
    const cppEmployeeRate = config?.cppEmployeeRate ?? 0.0595;
    const eiEmployeeRate = config?.eiEmployeeRate ?? 0.0166;
    const federalTaxRate = config?.federalTaxRate ?? 0.15;
    const provincialTaxRate = config?.provincialTaxRate ?? 0.0505;
    const cppEmployerRate = config?.cppEmployerRate ?? 0.0595;
    const eiEmployerRate = config?.eiEmployerRate ?? 0.0232;
    const wsibRate = config?.wsibRate ?? 0.0142;
    const vacationPayRate = config?.vacationPayRate ?? 0.04;

    const workedHours = await this.getWorkedHoursForPeriod(
      dto.workerId,
      dto.payPeriodStart,
      dto.payPeriodEnd,
    );

    const regularHours = workedHours;
    const overtimeHours = 0;

    // Gross Pay calculate
    const regularPay = regularHours * dto.ratePerHour;
    const overtimePay = overtimeHours * dto.ratePerHour * 1.5;
    const grossPay = Math.round((regularPay + overtimePay) * 100) / 100;

    // Employee Deductions
    const cppEmployee = Math.round(grossPay * cppEmployeeRate * 100) / 100;
    const eiEmployee = Math.round(grossPay * eiEmployeeRate * 100) / 100;
    const federalTax = Math.round(grossPay * federalTaxRate * 100) / 100;
    const provincialTax = Math.round(grossPay * provincialTaxRate * 100) / 100;
    const deductions = Math.round((cppEmployee + eiEmployee + federalTax + provincialTax) * 100) / 100;
    const netPay = Math.round((grossPay - deductions) * 100) / 100;

    // Employer Cost
    const cppEmployer = Math.round(grossPay * cppEmployerRate * 100) / 100;
    const eiEmployer = Math.round(grossPay * eiEmployerRate * 100) / 100;
    const wsib = Math.round(grossPay * wsibRate * 100) / 100;
    const vacationPay = Math.round(grossPay * vacationPayRate * 100) / 100;
    const employerCost = Math.round((grossPay + cppEmployer + eiEmployer + wsib + vacationPay) * 100) / 100;

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
        grossPay,
        deductions,
        netPay,
        employerCost,
        status: 'draft',
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
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  // ─── Payroll Summary ──────────────────────────────────────────────────────
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

    const totalHours = payrolls.reduce(
      (s, p) => s + p.regularHours + p.overtimeHours,
      0,
    );
    const totalPay = payrolls.reduce((s, p) => s + p.grossPay, 0);
    const pending = payrolls.filter((p) => p.status === 'draft').length;

    const inventoryAlerts = await this.prisma.inventoryItem.count({
      where: {
        currentQty: { lte: 0 },
        ...(projectId && { projectId }),
      },
    });

    return {
      summary: {
        totalHours,
        totalPay,
        pending,
        inventoryAlerts,
      },
      workers: payrolls.map((p) => ({
        payrollId: p.id,
        project: p.project,
        worker: p.worker,
        hours: p.regularHours,
        overtimeHours: p.overtimeHours,
        rate: p.ratePerHour,
        total: p.grossPay,
        status: p.status,
      })),
    };
  }

  // ─── Pay Stub ─────────────────────────────────────────────────────────────
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
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!payroll) throw new NotFoundException('Payroll not found');

    if (userRole === UserRole.worker && payroll.workerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const regularPay = payroll.regularHours * payroll.ratePerHour;
    const overtimePay = payroll.overtimeHours * payroll.ratePerHour * 1.5;
    const siteAllowance = 250;
    const grossPay = regularPay + overtimePay + siteAllowance;

    const federalTax = Math.round(grossPay * 0.15 * 100) / 100;
    const stateTax = Math.round(grossPay * 0.0505 * 100) / 100;
    const socialSec = Math.round(grossPay * 0.062 * 100) / 100;
    const medicare = Math.round(grossPay * 0.0145 * 100) / 100;
    const totalDeductions = federalTax + stateTax + socialSec + medicare;
    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

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
        regularPay,
        overtimeHours: payroll.overtimeHours,
        overtimePay,
        siteAllowance,
        grossPay,
      },
      deductions: {
        federalTax,
        stateTax,
        socialSecurity: socialSec,
        medicare,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
      },
      netPay,
      status: payroll.status,
    };
  }

  // ─── Approve Payroll ──────────────────────────────────────────────────────
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

  // ─── Process Payroll — Stripe Transfer ───────────────────────────────────
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
          select: {
            id: true,
            fullName: true,
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

    if (payrolls.length === 0) {
      throw new BadRequestException(
        'No approved payrolls found for this period',
      );
    }

    const results: Array<{
      payrollId: string;
      workerId: string;
      workerName: string;
      projectId?: string;
      projectName?: string;
      grossPay: number;
      deductions: number;
      netPay: number;
      status: 'calculated';
    }> = [];

    for (const payroll of payrolls) {
      results.push({
        payrollId: payroll.id,
        workerId: payroll.worker.id,
        workerName: payroll.worker.fullName,
        projectId: payroll.projectId ?? undefined,
        projectName: payroll.project?.name,
        grossPay: payroll.grossPay,
        deductions: payroll.deductions,
        netPay: payroll.netPay,
        status: 'calculated',
      });
    }

    const totalGrossPay = results.reduce((sum, item) => sum + item.grossPay, 0);
    const totalDeductions = results.reduce((sum, item) => sum + item.deductions, 0);
    const totalNetPay = results.reduce((sum, item) => sum + item.netPay, 0);

    return {
      message: `Payroll calculated for ${results.length} record(s)`,
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