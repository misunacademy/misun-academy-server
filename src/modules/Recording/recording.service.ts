import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { RecordingModel } from './recording.model.js';
import { IRecording } from './recording.interface.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { CourseModel } from '../Course/course.model.js';
import { Role } from '../../types/role.js';
import { NotificationService } from '../Notification/notification.service.js';
import { logger } from '../../config/logger.js';

const sendPublishNotification = (recording: IRecording, userId: string): void => {
    setImmediate(async () => {
        try {
            await NotificationService.createBatchNotification(
                recording.batchId.toString(),
                {
                    type: 'recording_published',
                    title: 'New Live Recording',
                    message: `New recording "${recording.title}" is now available`,
                    link: '/my-classes',
                },
                userId
            );
        } catch (error) {
            logger.error(error, 'Failed to send recording notification');
        }
    });
};

const getInstructorCourseIds = async (userId: string): Promise<string[]> => {
    const assignedCourses = await CourseModel.find(
        { instructorId: userId },
        '_id'
    ).lean();
    return assignedCourses.map((c: any) => c._id.toString());
};

const createRecording = async (
    recordingData: Partial<IRecording>,
    createdBy: string
): Promise<IRecording> => {
    if (recordingData.videoSource && recordingData.videoId) {
        recordingData.videoUrl =
            recordingData.videoSource === 'youtube'
                ? `https://www.youtube.com/embed/${recordingData.videoId}`
                : `https://drive.google.com/file/d/${recordingData.videoId}/preview`;
    }

    const recording = await RecordingModel.create({
        ...recordingData,
        createdBy,
    });

    if (recording.isPublished) {
        sendPublishNotification(recording, createdBy);
    }

    return recording;
};

const getAllRecordings = async (filters: {
    courseId?: string;
    courseIds?: string[];
    batchId?: string;
    isPublished?: boolean;
    page?: number;
    limit?: number;
    /** If true, restrict to courses assigned to the instructor */
    userId?: string;
    userRole?: string;
}) => {
    const { courseId, courseIds, batchId, isPublished, page = 1, limit = 20, userId, userRole } = filters;

    const query: any = {};

    if (userRole === Role.INSTRUCTOR && userId) {
        const assignedIds = await getInstructorCourseIds(userId);

        if (assignedIds.length === 0 || (courseId && !assignedIds.includes(courseId))) {
            return {
                data: [],
                meta: { page, limit, total: 0, totalPages: 0 },
            };
        }

        query.courseId = courseId ? courseId : { $in: assignedIds };
    } else if (courseId) {
        query.courseId = courseId;
    } else if (courseIds && courseIds.length > 0) {
        query.courseId = { $in: courseIds };
    }

    if (batchId) query.batchId = batchId;
    if (isPublished !== undefined) query.isPublished = isPublished;

    const skip = (page - 1) * limit;

    const [recordings, total] = await Promise.all([
        RecordingModel.find(query)
            .populate('courseId', 'title slug')
            .populate('batchId', 'title batchNumber')
            .populate('instructor', 'name email')
            .sort({ sessionDate: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        RecordingModel.countDocuments(query),
    ]);

    return {
        data: recordings,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

const getRecordingById = async (recordingId: string): Promise<IRecording> => {
    const recording = await RecordingModel.findById(recordingId)
        .populate('courseId', 'title slug')
        .populate('batchId', 'title batchNumber')
        .populate('instructor', 'name email')
        .lean();

    if (!recording) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Recording not found');
    }

    return recording;
};

const getBatchRecordings = async (batchId: string) => {
    const recordings = await RecordingModel.find({
        batchId,
        isPublished: true,
    })
        .populate('instructor', 'name email')
        .sort({ sessionDate: -1 })
        .lean();

    return recordings;
};

const getStudentRecordings = async (userId: string) => {
    // Get student's enrollments
    const enrollments = await EnrollmentModel.find({
        userId: userId,
        status: 'active',
    }).select('batchId').lean();

    // console.log('Student Enrollments:', {
    //     userId,
    //     enrollmentCount: enrollments.length,
    //     enrollments: enrollments.map((e: any) => ({
    //         batchId: e.batchId,
    //         status: e.status
    //     }))
    // });

    const batchIds = enrollments.map((e: any) => e.batchId);

    // Get all published recordings for enrolled batches
    const recordings = await RecordingModel.find({
        batchId: { $in: batchIds },
        isPublished: true,
    })
        .populate('courseId', 'title slug')
        .populate('batchId', 'title batchNumber')
        .populate('instructor', 'name email')
        .sort({ sessionDate: -1 })
        .lean();

    console.log('Student Recordings Found:', {
        batchIds: batchIds.map((id: any) => id.toString()),
        recordingCount: recordings.length,
        recordings: recordings.map(r => ({
            title: r.title,
            batchId: r.batchId,
            isPublished: r.isPublished
        }))
    });

    return recordings;
};

const updateRecording = async (
    recordingId: string,
    updateData: Partial<IRecording>,
    userId?: string
): Promise<IRecording> => {
    const oldRecording = await RecordingModel.findById(recordingId).lean();

    if (!oldRecording) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Recording not found');
    }

    if (updateData.videoSource && updateData.videoId) {
        updateData.videoUrl =
            updateData.videoSource === 'youtube'
                ? `https://www.youtube.com/embed/${updateData.videoId}`
                : `https://drive.google.com/file/d/${updateData.videoId}/preview`;
    }

    const recording = await RecordingModel.findByIdAndUpdate(
        recordingId,
        { $set: updateData },
        { new: true, runValidators: true }
    );

    if (!recording) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Recording not found');
    }

    if (!oldRecording.isPublished && recording.isPublished && userId) {
        sendPublishNotification(recording, userId);
    }

    return recording;
};

const deleteRecording = async (recordingId: string): Promise<void> => {
    const recording = await RecordingModel.findByIdAndDelete(recordingId);

    if (!recording) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Recording not found');
    }
};

const incrementViewCount = async (recordingId: string): Promise<void> => {
    await RecordingModel.findByIdAndUpdate(recordingId, {
        $inc: { viewCount: 1 },
    });
};

export const RecordingService = {
    createRecording,
    getAllRecordings,
    getRecordingById,
    getBatchRecordings,
    getStudentRecordings,
    updateRecording,
    deleteRecording,
    incrementViewCount,
    getInstructorCourseIds,
};
