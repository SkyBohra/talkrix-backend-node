import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CallHistory } from '../call-history/call-history.schema';
import { Agent } from '../agent/agent.schema';
import { Campaign } from '../campaign/campaign.schema';
import {
  DashboardStats,
  DashboardTrends,
  RecentCall,
  DashboardResponse,
  AgentPerformance,
  CallsByHour,
  CallsByDay,
  TrendData,
} from './dashboard.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(CallHistory.name) private callHistoryModel: Model<CallHistory>,
    @InjectModel(Agent.name) private agentModel: Model<Agent>,
    @InjectModel(Campaign.name) private campaignModel: Model<Campaign>,
  ) {}

  /**
   * Get complete dashboard data in a single optimized request
   * Uses parallel queries and aggregation for performance
   */
  async getDashboard(userId: string, period: 'today' | 'week' | 'month' = 'week'): Promise<DashboardResponse> {
    const { startDate, previousStartDate, previousEndDate } = this.getDateRange(period);

    // Run all queries in parallel for maximum performance
    const [stats, previousStats, recentCalls, agentCount, campaignCount] = await Promise.all([
      this.getCallStats(userId, startDate),
      this.getCallStats(userId, previousStartDate, previousEndDate),
      this.getRecentCalls(userId, 5),
      this.getAgentCounts(userId),
      this.getCampaignCounts(userId),
    ]);

    // Calculate trends
    const trends = this.calculateTrends(stats, previousStats);

    // Format duration
    const avgDurationFormatted = this.formatDuration(stats.avgDurationSeconds);

    return {
      stats: {
        ...stats,
        avgDurationFormatted,
        totalAgents: agentCount.total,
        activeAgents: agentCount.active,
        totalCampaigns: campaignCount.total,
        activeCampaigns: campaignCount.active,
      },
      trends,
      recentCalls,
      period,
    };
  }

  /**
   * Get call statistics using MongoDB aggregation (optimized single query)
   */
  private async getCallStats(
    userId: string,
    startDate: Date,
    endDate: Date = new Date(),
  ): Promise<Omit<DashboardStats, 'avgDurationFormatted' | 'totalAgents' | 'activeAgents' | 'totalCampaigns' | 'activeCampaigns'>> {
    const pipeline = [
      {
        $match: {
          userId,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          missedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] },
          },
          failedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
          totalDuration: { $sum: { $ifNull: ['$durationSeconds', 0] } },
          durationCount: {
            $sum: { $cond: [{ $gt: ['$durationSeconds', 0] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalCalls: 1,
          completedCalls: 1,
          missedCalls: 1,
          failedCalls: 1,
          avgDurationSeconds: {
            $cond: [
              { $gt: ['$durationCount', 0] },
              { $round: [{ $divide: ['$totalDuration', '$durationCount'] }, 0] },
              0,
            ],
          },
          successRate: {
            $cond: [
              { $gt: ['$totalCalls', 0] },
              { $round: [{ $multiply: [{ $divide: ['$completedCalls', '$totalCalls'] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
    ];

    const result = await this.callHistoryModel.aggregate(pipeline).exec();

    if (!result || result.length === 0) {
      return {
        totalCalls: 0,
        completedCalls: 0,
        missedCalls: 0,
        failedCalls: 0,
        avgDurationSeconds: 0,
        successRate: 0,
      };
    }

    return result[0];
  }

  /**
   * Get recent calls with minimal data for dashboard
   */
  private async getRecentCalls(userId: string, limit: number = 5): Promise<RecentCall[]> {
    const calls = await this.callHistoryModel
      .find({ userId })
      .select('_id customerName customerPhone agentName durationSeconds status callType createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<Array<{
        _id: Types.ObjectId;
        customerName?: string;
        customerPhone?: string;
        agentName?: string;
        durationSeconds?: number;
        status: string;
        callType?: string;
        createdAt: Date;
      }>>()
      .exec();

    return calls.map((call) => ({
      id: call._id.toString(),
      caller: call.customerName || call.customerPhone || 'Unknown',
      agentName: call.agentName || 'Agent',
      duration: this.formatDuration(call.durationSeconds || 0),
      durationSeconds: call.durationSeconds || 0,
      time: this.getRelativeTime(call.createdAt),
      status: this.mapCallStatus(call.status),
      callType: call.callType || 'unknown',
    }));
  }

  /**
   * Get agent counts efficiently
   */
  private async getAgentCounts(userId: string): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.agentModel.countDocuments({ userId }).exec(),
      // Consider agents with calls in last 24h as "active"
      this.callHistoryModel.distinct('agentId', {
        userId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }).then(ids => ids.length),
    ]);

    return { total, active };
  }

  /**
   * Get campaign counts efficiently
   */
  private async getCampaignCounts(userId: string): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.campaignModel.countDocuments({ userId }).exec(),
      this.campaignModel.countDocuments({ userId, status: 'active' }).exec(),
    ]);

    return { total, active };
  }

  /**
   * Calculate trends comparing current vs previous period
   */
  private calculateTrends(
    current: Omit<DashboardStats, 'avgDurationFormatted' | 'totalAgents' | 'activeAgents' | 'totalCampaigns' | 'activeCampaigns'>,
    previous: Omit<DashboardStats, 'avgDurationFormatted' | 'totalAgents' | 'activeAgents' | 'totalCampaigns' | 'activeCampaigns'>,
  ): DashboardTrends {
    return {
      calls: this.calculateTrend(current.totalCalls, previous.totalCalls),
      completed: this.calculateTrend(current.completedCalls, previous.completedCalls),
      missed: this.calculateTrend(current.missedCalls, previous.missedCalls, true), // inverted - less is better
      duration: this.calculateTrend(current.avgDurationSeconds, previous.avgDurationSeconds),
      successRate: this.calculateTrend(current.successRate, previous.successRate),
    };
  }

  /**
   * Calculate individual trend
   */
  private calculateTrend(current: number, previous: number, invertDirection = false): TrendData {
    if (previous === 0) {
      return { value: current, change: current > 0 ? 100 : 0, isUp: current > 0 };
    }

    const change = Math.round(((current - previous) / previous) * 100 * 10) / 10;
    const isUp = invertDirection ? change < 0 : change > 0;

    return { value: current, change: Math.abs(change), isUp };
  }

  /**
   * Get date ranges for period comparison
   */
  private getDateRange(period: 'today' | 'week' | 'month'): {
    startDate: Date;
    previousStartDate: Date;
    previousEndDate: Date;
  } {
    const now = new Date();
    let startDate: Date;
    let previousStartDate: Date;
    let previousEndDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        previousEndDate = new Date(startDate.getTime() - 1);
        previousStartDate = new Date(previousEndDate.getFullYear(), previousEndDate.getMonth(), previousEndDate.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        previousEndDate = new Date(startDate.getTime() - 1);
        previousStartDate = new Date(previousEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        previousEndDate = new Date(startDate.getTime() - 1);
        previousStartDate = new Date(previousEndDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    return { startDate, previousStartDate, previousEndDate };
  }

  /**
   * Format seconds to MM:SS or HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0:00';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get relative time string
   */
  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return new Date(date).toLocaleDateString();
  }

  /**
   * Map call status to dashboard status
   */
  private mapCallStatus(status: string): 'completed' | 'missed' | 'ongoing' | 'failed' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'missed':
        return 'missed';
      case 'in-progress':
      case 'initiated':
        return 'ongoing';
      default:
        return 'failed';
    }
  }

  /**
   * Get agent performance breakdown (optional endpoint)
   */
  async getAgentPerformance(userId: string, limit: number = 5): Promise<AgentPerformance[]> {
    const pipeline = [
      { $match: { userId } },
      {
        $group: {
          _id: '$agentId',
          agentName: { $first: '$agentName' },
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          totalDuration: { $sum: { $ifNull: ['$durationSeconds', 0] } },
          durationCount: {
            $sum: { $cond: [{ $gt: ['$durationSeconds', 0] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          agentId: '$_id',
          agentName: 1,
          totalCalls: 1,
          completedCalls: 1,
          successRate: {
            $cond: [
              { $gt: ['$totalCalls', 0] },
              { $round: [{ $multiply: [{ $divide: ['$completedCalls', '$totalCalls'] }, 100] }, 1] },
              0,
            ],
          },
          avgDuration: {
            $cond: [
              { $gt: ['$durationCount', 0] },
              { $round: [{ $divide: ['$totalDuration', '$durationCount'] }, 0] },
              0,
            ],
          },
        },
      },
      { $sort: { totalCalls: -1 as const } },
      { $limit: limit },
    ];

    return this.callHistoryModel.aggregate(pipeline).exec();
  }

  /**
   * Get calls by hour for chart (optional endpoint)
   */
  async getCallsByHour(userId: string, date: Date = new Date()): Promise<CallsByHour[]> {
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const pipeline = [
      {
        $match: {
          userId,
          createdAt: { $gte: startOfDay, $lt: endOfDay },
        },
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 as const } },
      {
        $project: {
          hour: '$_id',
          count: 1,
          _id: 0,
        },
      },
    ];

    const result = await this.callHistoryModel.aggregate(pipeline).exec();

    // Fill in missing hours with 0
    const hourlyData: CallsByHour[] = [];
    for (let h = 0; h < 24; h++) {
      const found = result.find((r) => r.hour === h);
      hourlyData.push({ hour: h, count: found?.count || 0 });
    }

    return hourlyData;
  }

  /**
   * Get calls by day for chart (optional endpoint)
   */
  async getCallsByDay(userId: string, days: number = 7): Promise<CallsByDay[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      {
        $match: {
          userId,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          missed: {
            $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 as const } },
      {
        $project: {
          date: '$_id',
          count: 1,
          completed: 1,
          missed: 1,
          _id: 0,
        },
      },
    ];

    return this.callHistoryModel.aggregate(pipeline).exec();
  }
}
