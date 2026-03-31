import { Types } from 'mongoose';
import { UserStatus } from '../../types/common.js';
import { Role } from '../../types/role.js';
import { Document } from 'mongoose';

export interface IUser {
    name: string;
    email: string;
    password?: string; // Optional for OAuth users
    role: Role;
    emailVerified: Boolean; // Better Auth uses Date instead of Boolean
    image?: string;
    avatar?: string;
    studentId?: string;
    phone?: string;
    address?: string;
    status: UserStatus;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IUserDocument extends IUser, Document {
    comparePassword?(password: string): Promise<boolean>;
    profilePicture?: string; // Virtual field
}

export interface GetUsersParams {
    search?: string;
    status?: UserStatus;
    page?: number;
    limit?: number;
}
