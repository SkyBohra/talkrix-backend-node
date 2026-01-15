import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CallHistory, CallStatus, CallType } from './call-history.schema';

export interface CallStats {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  failedCalls: number;
  averageDurationSeconds: number;
}

export interface CreateCallHistoryDto {
  agentId: string;
  userId: string;
  talkrixCallId: string;
  callType: CallType;
  agentName: string;
  customerName?: string;
  customerPhone?: string;
  recordingEnabled?: boolean;
  joinUrl?: string;
  callData?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface UpdateCallHistoryDto {
  status?: CallStatus;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  recordingUrl?: string;
  callData?: Record<string, any>;
  metadata?: Record<string, any>;
}

@Injectable()
export class CallHistoryService {
  constructor(
    @InjectModel(CallHistory.name) private callHistoryModel: Model<CallHistory>,
  ) {}

  async create(data: CreateCallHistoryDto): Promise<CallHistory> {
    const callHistory = new this.callHistoryModel({
      ...data,
      agentId: new Types.ObjectId(data.agentId),
      status: 'initiated',
    });
    return callHistory.save();
  }

  async findById(id: string): Promise<CallHistory | null> {
    return this.callHistoryModel.findById(id).select('-joinUrl -callData').exec();
  }

  async findByTalkrixCallId(talkrixCallId: string): Promise<CallHistory | null> {
    return this.callHistoryModel.findOne({ talkrixCallId }).select('-joinUrl -callData').exec();
  }

  async findByUserId(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      status?: CallStatus;
      callType?: CallType;
      agentId?: string;
    },
  ): Promise<{ calls: CallHistory[]; total: number; page: number; pages: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    const query: any = { userId };
    
    if (options?.status) {
      query.status = options.status;
    }
    if (options?.callType) {
      query.callType = options.callType;
    }
    if (options?.agentId) {
      query.agentId = new Types.ObjectId(options.agentId);
    }

    const [calls, total] = await Promise.all([
      this.callHistoryModel
        .find(query)
        .select('-joinUrl -callData')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.callHistoryModel.countDocuments(query).exec(),
    ]);

    return {
      calls,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async findByAgentId(
    agentId: string,
    options?: { page?: number; limit?: number },
  ): Promise<{ calls: CallHistory[]; total: number; page: number; pages: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    const query: any = { agentId: new Types.ObjectId(agentId) };

    const [calls, total] = await Promise.all([
      this.callHistoryModel
        .find(query)
        .select('-joinUrl -callData')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.callHistoryModel.countDocuments(query).exec(),
    ]);

    return {
      calls,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async update(id: string, data: UpdateCallHistoryDto): Promise<CallHistory | null> {
    return this.callHistoryModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async updateByTalkrixCallId(
    talkrixCallId: string,
    data: UpdateCallHistoryDto,
  ): Promise<CallHistory | null> {
    return this.callHistoryModel
      .findOneAndUpdate({ talkrixCallId }, data, { new: true })
      .exec();
  }

  async delete(id: string): Promise<CallHistory | null> {
    return this.callHistoryModel.findByIdAndDelete(id).exec();
  }

  async getStatsByUserId(userId: string): Promise<CallStats> {
    const pipeline = [
      { $match: { userId } },
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
          totalDuration: { $sum: '$durationSeconds' },
          completedCount: {
            $sum: { $cond: [{ $gt: ['$durationSeconds', 0] }, 1, 0] },
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
        averageDurationSeconds: 0,
      };
    }

    const stats = result[0];
    return {
      totalCalls: stats.totalCalls,
      completedCalls: stats.completedCalls,
      missedCalls: stats.missedCalls,
      failedCalls: stats.failedCalls,
      averageDurationSeconds:
        stats.completedCount > 0
          ? Math.round(stats.totalDuration / stats.completedCount)
          : 0,
    };
  }

  async getStatsByAgentId(agentId: string): Promise<CallStats> {
    const pipeline = [
      { $match: { agentId: new Types.ObjectId(agentId) } },
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
          totalDuration: { $sum: '$durationSeconds' },
          completedCount: {
            $sum: { $cond: [{ $gt: ['$durationSeconds', 0] }, 1, 0] },
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
        averageDurationSeconds: 0,
      };
    }

    const stats = result[0];
    return {
      totalCalls: stats.totalCalls,
      completedCalls: stats.completedCalls,
      missedCalls: stats.missedCalls,
      failedCalls: stats.failedCalls,
      averageDurationSeconds:
        stats.completedCount > 0
          ? Math.round(stats.totalDuration / stats.completedCount)
          : 0,
    };
  }
}
