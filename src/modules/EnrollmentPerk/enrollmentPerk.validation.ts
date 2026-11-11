import { z } from 'zod';
import { PerkBenefitType } from './enrollmentPerk.interface.js';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const optionalObjectId = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform(val => (val === '' || val === null || val === undefined ? undefined : val))
    .pipe(z.string().regex(objectIdRegex, 'Invalid ObjectId format').optional());

const perkBenefitSchema = z.object({
    type: z.nativeEnum(PerkBenefitType).default(PerkBenefitType.FreeCourse),
    targetCourseId: optionalObjectId,
    targetBatchId: optionalObjectId,
    targetBootcampId: optionalObjectId,
    accessDuration: z.object({
        type: z.enum(['lifetime', 'days']).default('lifetime'),
        days: z.number().int().positive().optional(),
    }).optional().default({ type: 'lifetime' }),
    extraConfig: z.record(z.any()).optional().default({}),
}).refine(data => {
    if (data.type === PerkBenefitType.FreeCourse && !data.targetCourseId) {
        return false;
    }
    if (data.type === PerkBenefitType.FreeBootcamp && !data.targetBootcampId) {
        return false;
    }
    return true;
}, {
    message: 'Target course or bootcamp is required for the selected benefit type',
    path: ['type'],
});

export const createPerkRuleSchema = z.object({
    body: z.object({
        courseId: z.string().regex(objectIdRegex, 'Invalid course ID'),
        batchId: z.string().regex(objectIdRegex, 'Invalid batch ID'),
        title: z.string().trim().min(2, 'Title must be at least 2 characters').max(150),
        isActive: z.boolean().optional().default(true),
        startDate: z.string().datetime().or(z.date()).optional().nullable(),
        endDate: z.string().datetime().or(z.date()).optional().nullable(),
        note: z.string().trim().max(1000).optional().nullable(),
        revokeOnCancel: z.boolean().optional().default(true),
        applyToAdminGrants: z.boolean().optional().default(true),
        benefits: z.array(perkBenefitSchema).min(1, 'At least one benefit is required'),
    }).refine(data => {
        // Enrolled course cannot be the same as any benefit target course
        const hasSelfTarget = data.benefits.some(
            b => b.type === PerkBenefitType.FreeCourse && b.targetCourseId === data.courseId
        );
        return !hasSelfTarget;
    }, {
        message: 'A benefit course cannot be the same as the enrolled course',
        path: ['benefits'],
    }).refine(data => {
        if (data.startDate && data.endDate) {
            return new Date(data.endDate) >= new Date(data.startDate);
        }
        return true;
    }, {
        message: 'Offer end date must be on or after offer start date',
        path: ['endDate'],
    }),
});

export const updatePerkRuleSchema = z.object({
    params: z.object({
        id: z.string().regex(objectIdRegex, 'Invalid rule ID'),
    }),
    body: z.object({
        courseId: z.string().regex(objectIdRegex, 'Invalid course ID').optional(),
        batchId: z.string().regex(objectIdRegex, 'Invalid batch ID').optional(),
        title: z.string().trim().min(2).max(150).optional(),
        isActive: z.boolean().optional(),
        startDate: z.string().datetime().or(z.date()).optional().nullable(),
        endDate: z.string().datetime().or(z.date()).optional().nullable(),
        note: z.string().trim().max(1000).optional().nullable(),
        revokeOnCancel: z.boolean().optional(),
        applyToAdminGrants: z.boolean().optional(),
        benefits: z.array(perkBenefitSchema).min(1).optional(),
    }).refine(data => {
        if (data.courseId && data.benefits) {
            const hasSelfTarget = data.benefits.some(
                b => b.type === PerkBenefitType.FreeCourse && b.targetCourseId === data.courseId
            );
            return !hasSelfTarget;
        }
        return true;
    }, {
        message: 'A benefit course cannot be the same as the enrolled course',
        path: ['benefits'],
    }).refine(data => {
        if (data.startDate && data.endDate) {
            return new Date(data.endDate) >= new Date(data.startDate);
        }
        return true;
    }, {
        message: 'Offer end date must be on or after offer start date',
        path: ['endDate'],
    }),
});

export const toggleRuleStatusSchema = z.object({
    params: z.object({
        id: z.string().regex(objectIdRegex, 'Invalid rule ID'),
    }),
    body: z.object({
        isActive: z.boolean(),
    }),
});

export const perkRuleIdParamSchema = z.object({
    params: z.object({
        id: z.string().regex(objectIdRegex, 'Invalid rule ID'),
    }),
});

export const listPerkRulesQuerySchema = z.object({
    query: z.object({
        courseId: z.string().regex(objectIdRegex).optional(),
        batchId: z.string().regex(objectIdRegex).optional(),
        isActive: z.enum(['true', 'false', 'all']).optional(),
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    }),
});

export const listPerkGrantsQuerySchema = z.object({
    query: z.object({
        ruleId: z.string().regex(objectIdRegex).optional(),
        studentId: z.string().regex(objectIdRegex).optional(),
        status: z.enum(['granted', 'revoked', 'all']).optional(),
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    }),
});
