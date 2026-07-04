import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma/client';
import PDFDocument from 'pdfkit';
import {
  GenerateReportDto,
  ExportReportDto,
  ReportType,
  PeriodFrequency,
} from './dto/reports.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ─── Date range helper ────────────────────────────────────────────────────
  private getDateRange(frequency: PeriodFrequency, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end   = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private formatMoney(value: number | null | undefined) {
    return `$${(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private toReportTitle(type: ReportType) {
    switch (type) {
      case ReportType.payroll:
        return 'Payroll Report';
      case ReportType.project_invoices:
        return 'Project Invoices Report';
      case ReportType.worker_performance:
        return 'Worker Performance Report';
      case ReportType.expense:
        return 'Expense Report';
      default:
        return 'Report';
    }
  }

  private async buildPdfBuffer(report: any) {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      this.writeReportToPdf(doc, report);
      this.decoratePdfPages(doc);
      doc.end();
    });

    return buffer;
  }

  private decoratePdfPages(doc: any) {
    const range = doc.bufferedPageRange();

    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      const { width, height, margins } = doc.page;
      const footerY = height - (margins.bottom ?? 40) + 10;

      doc.save();
      doc.lineWidth(1);
      doc.strokeColor('#E5E7EB');
      doc.moveTo(margins.left, footerY - 14);
      doc.lineTo(width - (margins.right ?? 40), footerY - 14);
      doc.stroke();

      doc.fontSize(9).fillColor('#6B7280');
      doc.text('PremierDD Reports', margins.left, footerY, {
        width: width - margins.left - (margins.right ?? 40),
        align: 'left',
      });
      doc.text(`Page ${i + 1} of ${range.count}`, margins.left, footerY, {
        width: width - margins.left - (margins.right ?? 40),
        align: 'right',
      });
      doc.restore();
    }
  }

  private drawHeader(doc: any, report: any) {
    const title = this.toReportTitle(report.type);
    const companyLabel = report.type === ReportType.project_invoices
      ? 'Company / Project Insights'
      : report.type === ReportType.payroll
        ? 'Payroll Overview'
        : report.type === ReportType.worker_performance
          ? 'Workforce Overview'
          : 'Expense Overview';

    doc.save();
    doc.roundedRect(40, 38, 515, 82, 16).fillAndStroke('#1D4F6D', '#1D4F6D');
    doc.fillColor('#FFFFFF');
    doc.fontSize(18).font('Helvetica-Bold').text('PremierDD', 60, 56);
    doc.fontSize(9).font('Helvetica').text(companyLabel, 60, 82);
    doc.fontSize(20).font('Helvetica-Bold').text(title, 270, 54, {
      width: 250,
      align: 'right',
    });
    doc.fontSize(9).font('Helvetica').text(`Generated ${new Date(report.generatedAt ?? Date.now()).toLocaleString()}`, 270, 82, {
      width: 250,
      align: 'right',
    });
    doc.restore();

    doc.moveDown(5.5);
  }

  private drawSectionTitle(doc: any, title: string, subtitle?: string) {
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#111827').text(title);
    if (subtitle) {
      doc.fontSize(9).font('Helvetica').fillColor('#6B7280').text(subtitle);
    }
    doc.moveDown(0.4);
  }

  private drawMetricCard(doc: any, x: number, y: number, width: number, label: string, value: string, accent: string) {
    doc.save();
    doc.roundedRect(x, y, width, 58, 12).fillAndStroke('#F9FAFB', '#E5E7EB');
    doc.fontSize(8).fillColor('#6B7280').text(label.toUpperCase(), x + 12, y + 10, {
      width: width - 24,
      align: 'left',
    });
    doc.fontSize(15).font('Helvetica-Bold').fillColor(accent).text(value, x + 12, y + 26, {
      width: width - 24,
      align: 'left',
    });
    doc.restore();
  }

  private writeReportToPdf(doc: any, report: any) {
    this.drawHeader(doc, report);
    const periodStart = report.period?.start ? new Date(report.period.start).toLocaleDateString() : 'N/A';
    const periodEnd = report.period?.end ? new Date(report.period.end).toLocaleDateString() : 'N/A';

    doc.fontSize(10).fillColor('#6B7280').text(`Period: ${periodStart} - ${periodEnd}`);
    doc.moveDown(1);

    const summary = report.summary ?? {};
    this.drawSectionTitle(doc, 'Summary', 'Key metrics for the selected range');

    const summaryItems: Array<{ label: string; value: string; accent: string }> = [];

    const summaryEntries = Object.entries(summary).filter(([key]) => key !== 'byStatus' && key !== 'byCategory');
    summaryEntries.slice(0, 4).forEach(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
      const displayValue = typeof value === 'number' ? this.formatMoney(value) : String(value);
      summaryItems.push({ label, value: displayValue, accent: '#1D4F6D' });
    });

    const cardWidth = 120;
    const gap = 10;
    const startX = 40;
    const cardY = doc.y + 4;
    summaryItems.forEach((item, index) => {
      this.drawMetricCard(doc, startX + (index * (cardWidth + gap)), cardY, cardWidth, item.label, item.value, item.accent);
    });
    if (summaryItems.length > 0) {
      doc.y = cardY + 68;
    }

    const byStatus = (summary as any).byStatus;
    if (byStatus && typeof byStatus === 'object') {
      this.drawSectionTitle(doc, 'Status Breakdown');
      Object.entries(byStatus).forEach(([key, value]) => {
        doc.fontSize(10).fillColor('#374151').text(`${key}: ${value}`);
      });
    }

    const byCategory = (summary as any).byCategory;
    if (byCategory && typeof byCategory === 'object') {
      this.drawSectionTitle(doc, 'Category Breakdown');
      Object.entries(byCategory).forEach(([key, value]) => {
        doc.fontSize(10).fillColor('#374151').text(`${key}: ${this.formatMoney(Number(value))}`);
      });
    }

    this.drawSectionTitle(doc, 'Details', 'Top items from the selected period');

    if (report.type === 'payroll') {
      (report.workers ?? []).slice(0, 12).forEach((worker: any, index: number) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1D4F6D').text(`${index + 1}. ${worker.worker?.fullName ?? 'Worker'}`);
        doc.fontSize(9).font('Helvetica').fillColor('#374151').text(
          `Attendance: ${worker.attendance?.attendanceRate ?? '0%'} | Tasks: ${worker.tasks?.completed ?? 0}/${worker.tasks?.total ?? 0} | Score: ${worker.performanceScore ?? '0%'}`
        );
        doc.text(
          `Gross: ${this.formatMoney(worker.totalGrossPay)} | Net: ${this.formatMoney(worker.totalNetPay)} | Deductions: ${this.formatMoney(worker.totalDeductions)}`
        );
        doc.moveDown(0.5);
      });
    } else if (report.type === 'project_invoices') {
      (report.projects ?? []).slice(0, 12).forEach((project: any, index: number) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1D4F6D').text(`${index + 1}. ${project.name}`);
        doc.fontSize(9).font('Helvetica').fillColor('#374151').text(
          `Company: ${project.company?.name ?? 'N/A'} | Status: ${project.status ?? 'N/A'} | Progress: ${project.progress ?? 0}%`
        );
        doc.text(
          `Budget: ${this.formatMoney(project.budget)} | Spent: ${this.formatMoney(project.spent)} | Remaining: ${this.formatMoney(project.remaining)}`
        );
        doc.moveDown(0.5);
      });
    } else if (report.type === 'worker_performance') {
      (report.workers ?? []).slice(0, 12).forEach((worker: any, index: number) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1D4F6D').text(`${index + 1}. ${worker.worker?.fullName ?? 'Worker'}`);
        doc.fontSize(9).font('Helvetica').fillColor('#374151').text(
          `Attendance: ${worker.attendance?.attendanceRate ?? '0%'} | Tasks: ${worker.tasks?.completed ?? 0}/${worker.tasks?.total ?? 0} | Reports: ${worker.reports?.approved ?? 0}/${worker.reports?.total ?? 0}`
        );
        doc.text(`Performance Score: ${worker.performanceScore ?? '0%'}`);
        doc.moveDown(0.5);
      });
    } else if (report.type === 'expense') {
      (report.expenses ?? []).slice(0, 15).forEach((expense: any, index: number) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1D4F6D').text(`${index + 1}. ${expense.description}`);
        doc.fontSize(9).font('Helvetica').fillColor('#374151').text(
          `Worker: ${expense.worker?.fullName ?? 'N/A'} | Project: ${expense.project?.name ?? 'N/A'} | Status: ${expense.status ?? 'N/A'}`
        );
        doc.text(`Category: ${expense.category ?? 'N/A'} | Amount: ${this.formatMoney(expense.amount)}`);
        doc.moveDown(0.5);
      });
    }
  }

  // ─── Access filter ────────────────────────────────────────────────────────
  private async getCompanyIds(userId: string, userRole: string, companyId?: string) {
    if (companyId) {
      if (userRole === UserRole.super_admin) {
        return [companyId];
      }

      const company = await this.prisma.company.findFirst({
        where: {
          id: companyId,
          ownerId: userId,
        },
        select: { id: true },
      });

      if (!company) {
        throw new ForbiddenException('You do not have access to this company');
      }

      return [company.id];
    }

    const companies = await this.prisma.company.findMany({
      where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
      select: { id: true },
    });
    return companies.map((c) => c.id);
  }

  // ─── MAIN: Generate Report ────────────────────────────────────────────────
  async generateReport(
    dto: GenerateReportDto,
    userId: string,
    userRole: string,
  ) {
    const { start, end } = this.getDateRange(dto.frequency, dto.startDate, dto.endDate);
    const companyIds     = await this.getCompanyIds(userId, userRole, dto.companyId);

    switch (dto.type) {
      case ReportType.payroll:
        return this.generatePayrollReport(start, end, companyIds, dto);
      case ReportType.project_invoices:
        return this.generateProjectInvoicesReport(start, end, companyIds, dto);
      case ReportType.worker_performance:
        return this.generateWorkerPerformanceReport(start, end, companyIds, dto);
      case ReportType.expense:
        return this.generateExpenseReport(start, end, companyIds, dto);
      default:
        throw new BadRequestException('Invalid report type');
    }
  }

  // ─── 1. PAYROLL REPORT ────────────────────────────────────────────────────
  private async generatePayrollReport(
    start: Date,
    end: Date,
    companyIds: string[],
    dto: GenerateReportDto,
  ) {
    const payrolls = await this.prisma.payroll.findMany({
      where: {
        companyId:      { in: companyIds },
        payPeriodStart: { gte: start },
        payPeriodEnd:   { lte: end },
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
        company: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalGrossPay     = payrolls.reduce((s, p) => s + p.grossPay,        0);
    const totalNetPay       = payrolls.reduce((s, p) => s + p.netPay,          0);
    const totalDeductions   = payrolls.reduce((s, p) => s + p.deductions,      0);
    const totalEmployerCost = payrolls.reduce((s, p) => s + (p.employerCost ?? 0), 0);
    const totalHours        = payrolls.reduce((s, p) => s + p.regularHours + p.overtimeHours, 0);

    const byStatus = {
      draft:    payrolls.filter((p) => p.status === 'draft').length,
      approved: payrolls.filter((p) => p.status === 'approved').length,
      paid:     payrolls.filter((p) => p.status === 'paid').length,
    };

    // Per worker breakdown
    const workerMap = new Map<string, any>();
    for (const p of payrolls) {
      const key = p.workerId;
      if (!workerMap.has(key)) {
        workerMap.set(key, {
          worker:         p.worker,
          totalGrossPay:  0,
          totalNetPay:    0,
          totalDeductions: 0,
          totalHours:     0,
          payrolls:       [],
        });
      }
      const entry = workerMap.get(key);
      entry.totalGrossPay   += p.grossPay;
      entry.totalNetPay     += p.netPay;
      entry.totalDeductions += p.deductions;
      entry.totalHours      += p.regularHours + p.overtimeHours;
      entry.payrolls.push({
        payrollId:  p.id,
        period:     `${p.payPeriodStart.toLocaleDateString()} - ${p.payPeriodEnd.toLocaleDateString()}`,
        grossPay:   p.grossPay,
        deductions: p.deductions,
        netPay:     p.netPay,
        status:     p.status,
      });
    }

    return {
      type:        'payroll',
      frequency:   dto.frequency,
      period:      { start, end },
      generatedAt: new Date(),
      summary: {
        totalWorkers:      workerMap.size,
        totalHours:        Math.round(totalHours        * 100) / 100,
        totalGrossPay:     Math.round(totalGrossPay     * 100) / 100,
        totalDeductions:   Math.round(totalDeductions   * 100) / 100,
        totalNetPay:       Math.round(totalNetPay       * 100) / 100,
        totalEmployerCost: Math.round(totalEmployerCost * 100) / 100,
        byStatus,
      },
      workers: Array.from(workerMap.values()).map((w) => ({
        ...w,
        totalGrossPay:   Math.round(w.totalGrossPay   * 100) / 100,
        totalNetPay:     Math.round(w.totalNetPay     * 100) / 100,
        totalDeductions: Math.round(w.totalDeductions * 100) / 100,
      })),
    };
  }

  // ─── 2. PROJECT INVOICES REPORT ───────────────────────────────────────────
  private async generateProjectInvoicesReport(
    start: Date,
    end: Date,
    companyIds: string[],
    dto: GenerateReportDto,
  ) {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId: { in: companyIds },
        ...(dto.projectId && { id: dto.projectId }),
        createdAt: { gte: start, lte: end },
      },
      include: {
        company:  { select: { id: true, name: true, logoUrl: true } },
        expenses: { select: { amount: true, status: true, category: true } },
        tasks:    { select: { status: true, estimatedHours: true, actualHours: true } },
        _count:   { select: { teamMembers: true, tasks: true, floors: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalBudget  = projects.reduce((s, p) => s + (p.budget  ?? 0), 0);
    const totalSpent   = projects.reduce((s, p) => s + (p.spent   ?? 0), 0);
    const totalRemaining = projects.reduce((s, p) => s + (p.remaining ?? 0), 0);

    const byStatus = {
      planning:   projects.filter((p) => p.status === 'planning').length,
      active:     projects.filter((p) => p.status === 'active').length,
      on_hold:    projects.filter((p) => p.status === 'on_hold').length,
      completed:  projects.filter((p) => p.status === 'completed').length,
      cancelled:  projects.filter((p) => p.status === 'cancelled').length,
    };

    return {
      type:        'project_invoices',
      frequency:   dto.frequency,
      period:      { start, end },
      generatedAt: new Date(),
      summary: {
        totalProjects:   projects.length,
        totalBudget:     Math.round(totalBudget    * 100) / 100,
        totalSpent:      Math.round(totalSpent     * 100) / 100,
        totalRemaining:  Math.round(totalRemaining * 100) / 100,
        byStatus,
      },
      projects: projects.map((p) => {
        const approvedExpenses = p.expenses
          .filter((e) => e.status === 'approved')
          .reduce((s, e) => s + e.amount, 0);
        const completedTasks = p.tasks.filter((t) => t.status === 'completed').length;

        return {
          id:               p.id,
          name:             p.name,
          company:          p.company,
          status:           p.status,
          progress:         p.progress,
          startDate:        p.startDate,
          endDate:          p.endDate,
          budget:           p.budget,
          spent:            p.spent,
          remaining:        p.remaining,
          approvedExpenses: Math.round(approvedExpenses * 100) / 100,
          taskCompletion:   p.tasks.length > 0
            ? Math.round((completedTasks / p.tasks.length) * 100)
            : 0,
          counts: p._count,
        };
      }),
    };
  }

  // ─── 3. WORKER PERFORMANCE REPORT ────────────────────────────────────────
  private async generateWorkerPerformanceReport(
    start: Date,
    end: Date,
    companyIds: string[],
    dto: GenerateReportDto,
  ) {
    if (companyIds.length === 0) {
      return {
        type:        'worker_performance',
        frequency:   dto.frequency,
        period:      { start, end },
        generatedAt: new Date(),
        summary: {
          totalWorkers:      0,
          avgAttendanceRate: '0%',
          avgTaskCompletion: '0%',
          topPerformer:      null,
        },
        workers: [],
      };
    }

    // Company scoped worker ids from accepted invitations + active project work + payroll history
    const acceptedInvitations = await this.prisma.invitation.findMany({
      where: {
        role:       'worker',
        status:     'accepted',
        receiverId: { not: null },
      },
      select: { receiverId: true },
    });

    const workerIds = acceptedInvitations
      .map((i) => i.receiverId)
      .filter(Boolean) as string[];

    const workers = await this.prisma.user.findMany({
      where: {
        id:   { in: workerIds },
        role: 'worker',
        OR: [
          {
            assignedTasks: {
              some: {
                project: {
                  companyId: { in: companyIds },
                },
              },
            },
          },
          {
            taskReports: {
              some: {
                task: {
                  project: {
                    companyId: { in: companyIds },
                  },
                },
              },
            },
          },
          {
            payrolls: {
              some: {
                companyId: { in: companyIds },
              },
            },
          },
        ],
      },
      select: {
        id:        true,
        fullName:  true,
        avatarUrl: true,
        department: true,
        attendances: {
          where: {
            date: { gte: start, lte: end },
          },
          select: {
            date:       true,
            status:     true,
            totalHours: true,
          },
        },
        assignedTasks: {
          where: {
            createdAt: { gte: start, lte: end },
          },
          select: {
            id:           true,
            status:       true,
            priority:     true,
            estimatedHours: true,
            actualHours:  true,
            dueDate:      true,
          },
        },
        taskReports: {
          where: {
            submittedAt: { gte: start, lte: end },
          },
          select: {
            reviewDecision: true,
            submittedAt:    true,
          },
        },
      },
    });

    const performanceData = workers.map((w) => {
      const totalDays       = w.attendances.length;
      const presentDays     = w.attendances.filter((a) => a.status === 'present').length;
      const totalHours      = w.attendances.reduce((s, a) => s + (a.totalHours ?? 0), 0);
      const attendanceRate  = totalDays > 0
        ? Math.round((presentDays / totalDays) * 100)
        : 0;

      const totalTasks      = w.assignedTasks.length;
      const completedTasks  = w.assignedTasks.filter((t) => t.status === 'completed').length;
      const inProgressTasks = w.assignedTasks.filter((t) => t.status === 'in_progress').length;
      const taskCompletion  = totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

      const approvedReports = w.taskReports.filter((r) => r.reviewDecision === 'approved').length;
      const reportApprovalRate = w.taskReports.length > 0
        ? Math.round((approvedReports / w.taskReports.length) * 100)
        : 0;

      // Overall performance score (weighted)
      const performanceScore = Math.round(
        (attendanceRate * 0.4) +
        (taskCompletion * 0.4) +
        (reportApprovalRate * 0.2),
      );

      return {
        worker: {
          id:         w.id,
          fullName:   w.fullName,
          avatarUrl:  w.avatarUrl,
          department: w.department,
        },
        attendance: {
          totalDays,
          presentDays,
          attendanceRate: `${attendanceRate}%`,
          totalHours:     Math.round(totalHours * 100) / 100,
        },
        tasks: {
          total:        totalTasks,
          completed:    completedTasks,
          inProgress:   inProgressTasks,
          completionRate: `${taskCompletion}%`,
        },
        reports: {
          total:        w.taskReports.length,
          approved:     approvedReports,
          approvalRate: `${reportApprovalRate}%`,
        },
        performanceScore: `${performanceScore}%`,
      };
    });

    // Sort by performance score desc
    performanceData.sort(
      (a, b) =>
        parseInt(b.performanceScore) - parseInt(a.performanceScore),
    );

    const avgAttendance = performanceData.length > 0
      ? Math.round(
          performanceData.reduce(
            (s, w) => s + parseInt(w.attendance.attendanceRate), 0,
          ) / performanceData.length,
        )
      : 0;

    const avgTaskCompletion = performanceData.length > 0
      ? Math.round(
          performanceData.reduce(
            (s, w) => s + parseInt(w.tasks.completionRate), 0,
          ) / performanceData.length,
        )
      : 0;

    return {
      type:        'worker_performance',
      frequency:   dto.frequency,
      period:      { start, end },
      generatedAt: new Date(),
      summary: {
        totalWorkers:       performanceData.length,
        avgAttendanceRate:  `${avgAttendance}%`,
        avgTaskCompletion:  `${avgTaskCompletion}%`,
        topPerformer:       performanceData[0]?.worker ?? null,
      },
      workers: performanceData,
    };
  }

  // ─── 4. EXPENSE REPORT ────────────────────────────────────────────────────
  private async generateExpenseReport(
    start: Date,
    end: Date,
    companyIds: string[],
    dto: GenerateReportDto,
  ) {
    const expenses = await this.prisma.expense.findMany({
      where: {
        ...(dto.projectId && { projectId: dto.projectId }),
        project: {
          companyId: { in: companyIds },
        },
        date: { gte: start, lte: end },
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
      orderBy: { date: 'desc' },
    });

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

    // Category breakdown
    const categoryMap = new Map<string, number>();
    for (const e of expenses) {
      const cat = e.category as string;
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + e.amount);
    }

    const byCategory = Object.fromEntries(
      Array.from(categoryMap.entries()).map(([k, v]) => [
        k,
        Math.round(v * 100) / 100,
      ]),
    );

    return {
      type:        'expense',
      frequency:   dto.frequency,
      period:      { start, end },
      generatedAt: new Date(),
      summary: {
        total:          expenses.length,
        totalAmount:    Math.round(totalAmount    * 100) / 100,
        approvedAmount: Math.round(approvedAmount * 100) / 100,
        pendingAmount:  Math.round(pendingAmount  * 100) / 100,
        rejectedAmount: Math.round(rejectedAmount * 100) / 100,
        byCategory,
      },
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

  // ─── Export All Data ──────────────────────────────────────────────────────
  async exportAllData(
    dto: ExportReportDto,
    userId: string,
    userRole: string,
  ) {
    const start      = dto.startDate ? new Date(dto.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end        = dto.endDate   ? new Date(dto.endDate)   : new Date();

    const generateDto = {
      type:      dto.type,
      frequency: 'monthly' as any,
      startDate: start.toISOString(),
      endDate:   end.toISOString(),
      companyId: dto.companyId,
    };

    const report = await this.generateReport(generateDto, userId, userRole);

    return {
      exportedAt: new Date(),
      ...report,
    };
  }

  async exportReportPdf(
    dto: ExportReportDto,
    userId: string,
    userRole: string,
  ) {
    const report = await this.exportAllData(dto, userId, userRole);
    const buffer = await this.buildPdfBuffer(report);

    return {
      filename: `${report.type}-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      buffer,
    };
  }
}
