import { Schema, model } from 'mongoose';
import bcrypt from 'bcrypt';
import { UserStatus } from '../../types/common.js';
import { Role } from '../../types/role.js';
import { IUserDocument } from './user.interface.js';

const userSchema = new Schema<IUserDocument>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true, lowercase: true },
        password: { type: String, select: false }, // Optional for OAuth users
        role: {
            type: String,
            enum: Object.values(Role),
            default: Role.LEARNER,
            required: true,
        },
        image: { type: String },
        emailVerified: { type: Boolean, default: false }, // Better Auth uses Date, null means not verified
        avatar: { type: String },
        studentId: { type: String, unique: true, sparse: true },
        phone: { type: String },
        address: { type: String },
        status: {
            type: String,
            enum: Object.values(UserStatus),
            default: UserStatus.Active,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Virtual field for profilePicture (alias for avatar/image)
userSchema.virtual('profilePicture').get(function () {
    return this.avatar || this.image;
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password as string, salt);
    next();
});

// Compare password method (for backwards compatibility, though Better Auth handles this)
userSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
    if (!this.password) return false;
    return await bcrypt.compare(password, this.password);
};

// Indexes
userSchema.index({ role: 1, status: 1 });
userSchema.index({ name: 1 });

export const UserModel = model<IUserDocument>('User', userSchema);
