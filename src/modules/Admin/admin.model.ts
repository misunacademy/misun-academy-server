import { Schema, model, Document } from 'mongoose';
import bcrypt from 'bcrypt';
import { Role } from '../../types/role.js';

export interface IAdminDocument extends Document {
    name: string;
    email: string;
    password: string;
    role: Role;
    comparePassword: (password: string) => Promise<boolean>;
}

const adminSchema = new Schema<IAdminDocument>({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: Object.values(Role), default: Role.ADMIN },
}, { timestamps: true });

adminSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

adminSchema.methods.comparePassword = async function (password: string) {
    return await bcrypt.compare(password, this.password);
};

export const AdminModel = model<IAdminDocument>('Admin', adminSchema);
