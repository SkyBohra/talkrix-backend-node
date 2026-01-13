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
    const user = new this.userModel({ email, password: hash, name, apiKey });
    return user.save();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async findByApiKey(apiKey: string) {
    return this.userModel.findOne({ apiKey });
  }
}
