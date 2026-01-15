import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from './agent.schema';

@Injectable()
export class AgentService {
  constructor(@InjectModel(Agent.name) private agentModel: Model<Agent>) {}

  async create(agentData: Partial<Agent>): Promise<Agent> {
    const agent = new this.agentModel(agentData);
    return agent.save();
  }

  async findAll(): Promise<Agent[]> {
    return this.agentModel.find().exec();
  }

  async findByUserId(userId: string): Promise<Agent[]> {
    return this.agentModel.find({ userId }).exec();
  }

  // Find agents by user ID with pagination
  async findByUserIdPaginated(userId: string, page: number = 1, limit: number = 10): Promise<{
    agents: Agent[];
    total: number;
    page: number;
    pages: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;
    const [agents, total] = await Promise.all([
      this.agentModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.agentModel.countDocuments({ userId }).exec(),
    ]);
    
    return {
      agents,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    };
  }

  async findOne(id: string): Promise<Agent | null> {
    return this.agentModel.findById(id).exec();
  }

  async update(id: string, updateData: Partial<Agent>): Promise<Agent | null> {
    return this.agentModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  async delete(id: string): Promise<Agent | null> {
    return this.agentModel.findByIdAndDelete(id).exec();
  }
}
