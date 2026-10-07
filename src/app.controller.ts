import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getDashboard(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(this.appService.getDashboardHtml());
  }

  @Get('telemetry')
  async getTelemetry() {
    return this.appService.getTelemetryData();
  }
}
