import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError.js";
import { AdminModel } from "./admin.model.js";
import { generateToken } from "../../utils/jwt.js";
import { Types } from "mongoose";


export const AdminAuthService = {
    async login(email: string, password: string) {
        const admin = await AdminModel.findOne({ email });

        if (!admin) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Invalid credentials');
        }

        const isPasswordMatch = await admin.comparePassword(password);

        if (!isPasswordMatch) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Invalid credentials');
        }

        const token = generateToken({
            id: admin._id as Types.ObjectId,
            role: admin.role
        });

        return {
            token, user: {
                name: admin.name
            }
        };
    },
};

