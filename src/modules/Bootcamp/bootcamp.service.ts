import { FilterQuery, Types } from 'mongoose';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { recordAudit } from '../../models/auditLog.model.js';
import {
    BootcampRegistrationModel,
} from './bootcamp.model.js';
import {
    BootcampRegistrationStatus,
    IBootcampRegistration,
} from './bootcamp.interface.js';

interface RegisterBootcampPayload {
    name: string;
    whatsapp?: string;
    address: string;
    email: string;
    paymentLast4: string;
}

interface BootcampQuery {
    status?: BootcampRegistrationStatus;
    search?: string;
    page?: number;
    limit?: number;
}

const registerBootcampRegistration = async (
    payload: RegisterBootcampPayload,
    ip?: string
): Promise<IBootcampRegistration> => {
    const email = payload.email.toLowerCase().trim();
    const whatsapp = payload.whatsapp?.trim() || undefined;

    const duplicateQuery: FilterQuery<IBootcampRegistration> = {
        email,
        status: { $ne: BootcampRegistrationStatus.Rejected },
    };

    const existing = await BootcampRegistrationModel.findOne(duplicateQuery).lean();

    if (existing) {
        throw new ApiError(
            StatusCodes.CONFLICT,
            'This email is already registered for the bootcamp'
        );
    }

    if (whatsapp) {
        const existingPhone = await BootcampRegistrationModel.findOne({
            whatsapp,
            status: { $ne: BootcampRegistrationStatus.Rejected },
        }).lean();

        if (existingPhone) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'This WhatsApp number is already registered for the bootcamp'
            );
        }
    }

    return BootcampRegistrationModel.create({
        ...payload,
        email,
        whatsapp,
        registrationIp: ip,
    });
};

const getAllBootcampRegistrations = async (params?: BootcampQuery) => {
    const { status, search, page = 1, limit = 10 } = params ?? {};

    const query: FilterQuery<IBootcampRegistration> = {};

    if (status) {
        query.status = status;
    }

    if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
            { name: searchRegex },
            { email: searchRegex },
            { whatsapp: searchRegex },
            { address: searchRegex },
        ];
    }

    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.max(1, limit || 10);
    const skip = (safePage - 1) * safeLimit;

    const total = await BootcampRegistrationModel.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));

    const data = await BootcampRegistrationModel.find(query)
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean();

    return {
        data,
        meta: {
            total,
            page: safePage,
            limit: safeLimit,
            totalPages,
        },
    };
};

const getBootcampRegistrationStats = async () => {
    const [total, pending, verified, rejected, today] = await Promise.all([
        BootcampRegistrationModel.countDocuments(),
        BootcampRegistrationModel.countDocuments({ status: BootcampRegistrationStatus.Pending }),
        BootcampRegistrationModel.countDocuments({ status: BootcampRegistrationStatus.Verified }),
        BootcampRegistrationModel.countDocuments({ status: BootcampRegistrationStatus.Rejected }),
        BootcampRegistrationModel.countDocuments({
            createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        }),
    ]);

    return { total, pending, verified, rejected, today };
};

const updateBootcampRegistration = async (
    id: string,
    payload: { status?: BootcampRegistrationStatus; adminNote?: string },
    actor: { id: string; role?: string },
    requestIp?: string
): Promise<IBootcampRegistration | null> => {
    const registration = await BootcampRegistrationModel.findById(id);

    if (!registration) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp registration not found');
    }

    if (payload.status) {
        registration.status = payload.status;
        registration.reviewedBy = new Types.ObjectId(actor.id);
        registration.reviewedAt = new Date();
    }

    if (payload.adminNote !== undefined) {
        registration.adminNote = payload.adminNote;
    }

    await registration.save();

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp_registration_update',
        targetType: 'BootcampRegistration',
        targetId: id,
        metadata: {
            status: registration.status,
            adminNote: registration.adminNote,
        },
        ip: requestIp,
    });

    return registration;
};

const deleteBootcampRegistration = async (
    id: string,
    actor: { id: string; role?: string },
    requestIp?: string
): Promise<IBootcampRegistration | null> => {
    const registration = await BootcampRegistrationModel.findByIdAndDelete(id);

    if (!registration) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp registration not found');
    }

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp_registration_delete',
        targetType: 'BootcampRegistration',
        targetId: id,
        metadata: {
            email: registration.email,
            name: registration.name,
        },
        ip: requestIp,
    });

    return registration;
};

export const BootcampService = {
    registerBootcampRegistration,
    getAllBootcampRegistrations,
    getBootcampRegistrationStats,
    updateBootcampRegistration,
    deleteBootcampRegistration,
};
