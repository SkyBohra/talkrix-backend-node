import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';

@Controller('dashboard')
@UseGuards(AuthOrApiKeyGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly responseHelper: ResponseHelper,
  ) {}

  /**
   * GET /dashboard
   * Main dashboard endpoint - returns all stats, trends, and recent calls
   * Query params: period (today | week | month)
   */
  @Get()
  async getDashboard(
    @Req() req: any,
    @Query('period') period: 'today' | 'week' | 'month' = 'week',
  ) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return this.responseHelper.error('User ID not found', 401);
      }

      const data = await this.dashboardService.getDashboard(userId, period);
      return this.responseHelper.success(data, 'Dashboard data retrieved successfully');
    } catch (error) {
      console.error('Dashboard error:', error);
      return this.responseHelper.error('Failed to fetch dashboard data', 500);
    }
  }

  /**
   * GET /dashboard/stats
   * Lightweight endpoint - returns only stats without recent calls
   */
  @Get('stats')
  async getStats(
    @Req() req: any,
    @Query('period') period: 'today' | 'week' | 'month' = 'week',
  ) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return this.responseHelper.error('User ID not found', 401);
      }

      const data = await this.dashboardService.getDashboard(userId, period);
      // Return only stats and trends for lighter payload
      return this.responseHelper.success(
        { stats: data.stats, trends: data.trends, period: data.period },
        'Dashboard stats retrieved successfully',
      );
    } catch (error) {
      console.error('Dashboard stats error:', error);
      return this.responseHelper.error('Failed to fetch dashboard stats', 500);
    }
  }

  /**
   * GET /dashboard/agents
   * Agent performance breakdown
   */
  @Get('agents')
  async getAgentPerformance(
    @Req() req: any,
    @Query('limit') limit: string = '5',
  ) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return this.responseHelper.error('User ID not found', 401);
      }

      const data = await this.dashboardService.getAgentPerformance(
        userId,
        Math.min(parseInt(limit) || 5, 20),
      );
      return this.responseHelper.success(data, 'Agent performance retrieved successfully');
    } catch (error) {
      console.error('Agent performance error:', error);
      return this.responseHelper.error('Failed to fetch agent performance', 500);
    }
  }

  /**
   * GET /dashboard/calls/hourly
   * Calls by hour for today (for charts)
   */
  @Get('calls/hourly')
  async getCallsByHour(@Req() req: any) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return this.responseHelper.error('User ID not found', 401);
      }

      const data = await this.dashboardService.getCallsByHour(userId);
      return this.responseHelper.success(data, 'Hourly calls retrieved successfully');
    } catch (error) {
      console.error('Hourly calls error:', error);
      return this.responseHelper.error('Failed to fetch hourly calls', 500);
    }
  }

  /**
   * GET /dashboard/calls/daily
   * Calls by day for charts
   */
  @Get('calls/daily')
  async getCallsByDay(
    @Req() req: any,
    @Query('days') days: string = '7',
  ) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return this.responseHelper.error('User ID not found', 401);
      }

      const data = await this.dashboardService.getCallsByDay(
        userId,
        Math.min(parseInt(days) || 7, 90),
      );
      return this.responseHelper.success(data, 'Daily calls retrieved successfully');
    } catch (error) {
      console.error('Daily calls error:', error);
      return this.responseHelper.error('Failed to fetch daily calls', 500);
    }
  }
}
