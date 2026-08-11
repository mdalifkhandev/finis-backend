import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TimeAdjustmentType, TimeAdjustmentStatus } from '../generated/prisma/client';

@Injectable()
export class TimeAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async createRequest(workerId: string, data: { date: string; requestType: 'check_in' | 'check_out'; originalTime: string; adjustedTime: string; reason?: string }) {
    return this.prisma.timeAdjustmentRequest.create({
      data: {
        workerId,
        date: new Date(data.date),
        requestType: data.requestType as TimeAdjustmentType,
        originalTime: new Date(data.originalTime),
        adjustedTime: new Date(data.adjustedTime),
        reason: data.reason,
      },
    });
  }

  async getPendingRequests(user: any) {
    let whereClause: any = { status: 'pending' };

    console.log('[getPendingRequests] USER:', user);

    // Temporary: remove all filtering for testing
    // if (user.role === 'manager' || user.role === 'project_manager') {
    //   ...
    // } else if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'company_admin') {
    //   if (user.tenantId) {
    //     whereClause.worker = { tenantId: user.tenantId };
    //   }
    // }

    whereClause = { status: 'pending' };

    console.log('[getPendingRequests] WHERE CLAUSE:', JSON.stringify(whereClause, null, 2));

    const results = await this.prisma.timeAdjustmentRequest.findMany({
      where: whereClause,
      include: {
        worker: {
          select: { id: true, fullName: true, employeeId: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
    console.log('[getPendingRequests] RESULTS COUNT:', results.length);
    return results;
  }

  async updateRequestStatus(id: string, status: 'approved' | 'denied', reviewedBy: string) {
    const request = await this.prisma.timeAdjustmentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') throw new BadRequestException('Request is not pending');

    const updated = await this.prisma.timeAdjustmentRequest.update({
      where: { id },
      data: {
        status: status as TimeAdjustmentStatus,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });

    if (status === 'approved') {
      const attendance = await this.prisma.attendance.findFirst({
        where: {
          userId: request.workerId,
          date: request.date,
        },
        include: { sessions: { orderBy: { checkInTime: 'asc' } } },
      });

      if (attendance && attendance.sessions.length > 0) {
        const sessions = attendance.sessions;
        if (request.requestType === 'check_in') {
          const firstSession = sessions[0];
          await this.prisma.attendanceSession.update({
            where: { id: firstSession.id },
            data: { checkInTime: request.adjustedTime },
          });
        } else {
          const lastSession = sessions[sessions.length - 1];
          await this.prisma.attendanceSession.update({
            where: { id: lastSession.id },
            data: { checkOutTime: request.adjustedTime },
          });
        }

        // Recalculate total hours for attendance
        const updatedAttendance = await this.prisma.attendance.findUnique({
          where: { id: attendance.id },
          include: { sessions: true },
        });

        if (updatedAttendance) {
          const totalHours = updatedAttendance.sessions.reduce((sum, session) => {
            if (!session.checkInTime || !session.checkOutTime) return sum;
            const diffMs = session.checkOutTime.getTime() - session.checkInTime.getTime();
            return sum + (diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0);
          }, 0);
          await this.prisma.attendance.update({
            where: { id: attendance.id },
            data: { totalHours: Math.round(totalHours * 100) / 100 },
          });
        }
      } else {
        // Fallback: This is a schedule change request
        const assignment = await this.prisma.workScheduleAssignment.findFirst({
          where: { userId: request.workerId },
          include: { schedule: true },
        });
        
        if (assignment && assignment.schedule) {
          const hours = request.adjustedTime.getHours();
          const minutes = request.adjustedTime.getMinutes();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const hrs12 = hours % 12 || 12;
          const minsStr = minutes < 10 ? '0' + minutes : minutes.toString();
          const timeStr = `${hrs12.toString().padStart(2, '0')}:${minsStr} ${ampm}`;

          const newSchedule = await this.prisma.workSchedule.create({
            data: {
              companyId: assignment.schedule.companyId,
              name: assignment.schedule.name.replace(/ \(Adjusted\)/g, '') + ' (Adjusted)',
              startTime: request.requestType === 'check_in' ? timeStr : assignment.schedule.startTime,
              endTime: request.requestType === 'check_out' ? timeStr : assignment.schedule.endTime,
              days: assignment.schedule.days
            }
          });

          await this.prisma.workScheduleAssignment.update({
            where: { id: assignment.id },
            data: { scheduleId: newSchedule.id }
          });
        }
      }
    }

    return updated;
  }
}
