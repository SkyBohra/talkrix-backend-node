import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tool } from './tool.schema';

@Injectable()
export class ToolService {
  constructor(
    @InjectModel(Tool.name) private toolModel: Model<Tool>,
  ) {}

  async create(toolData: Partial<Tool>): Promise<Tool> {
    const tool = new this.toolModel(toolData);
    return tool.save();
  }

  async findAll(): Promise<Tool[]> {
    return this.toolModel.find().exec();
  }

  async findByUserId(userId: string): Promise<Tool[]> {
    return this.toolModel.find({ userId }).exec();
  }

  async findOne(id: string): Promise<Tool | null> {
    return this.toolModel.findById(id).exec();
  }

  async findByTalkrixToolId(talkrixToolId: string): Promise<Tool | null> {
    return this.toolModel.findOne({ talkrixToolId }).exec();
  }

  async update(id: string, updateData: Partial<Tool>): Promise<Tool | null> {
    return this.toolModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  async delete(id: string): Promise<Tool | null> {
    return this.toolModel.findByIdAndDelete(id).exec();
  }

  async deleteByTalkrixToolId(talkrixToolId: string): Promise<Tool | null> {
    return this.toolModel.findOneAndDelete({ talkrixToolId }).exec();
  }
}
