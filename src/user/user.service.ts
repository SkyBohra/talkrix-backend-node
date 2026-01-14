import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './user.schema';
import * as bcrypt from 'bcryptjs';
import { generateApiKey } from './api-key.util';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async create(email: string, password: string, name: string) {
    const hash = await bcrypt.hash(password, 10);
    const apiKey = generateApiKey();
    // Default maxCorpusLimit is 1 (set in schema), can be changed per user in database
    const user = new this.userModel({ email, password: hash, name, apiKey });
    return user.save();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async findByApiKey(apiKey: string) {
    return this.userModel.findOne({ apiKey });
  }

  async findById(id: string) {
    return this.userModel.findById(id);
  }

  async updateMaxCorpusLimit(userId: string, limit: number) {
    return this.userModel.findByIdAndUpdate(userId, { maxCorpusLimit: limit }, { new: true });
  }
}
