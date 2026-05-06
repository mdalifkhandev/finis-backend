import {
    Controller,
    Get,
    Query
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../generated/prisma/client';

@Controller('admin/payroll/public')
export class PublicPayrollController {
    constructor(private payrollService: PayrollService) { }

    /** GET /admin/payroll/onboarding/complete */
    @Get('onboarding/complete')
    @Roles(UserRole.worker, UserRole.admin, UserRole.super_admin)
    async onboardingComplete(@Query('workerId') workerId: string) {
        const result = await this.payrollService.getOnboardingStatus(workerId);
        return { message: 'Onboarding complete', ...result };
    }

    /** GET /admin/payroll/onboarding/refresh */
    @Get('onboarding/refresh')
    @Roles(UserRole.worker, UserRole.admin, UserRole.super_admin)
    async onboardingRefresh(@Query('workerId') workerId: string) {
        const result = await this.payrollService.startWorkerOnboarding(workerId);
        return result;
    }


}