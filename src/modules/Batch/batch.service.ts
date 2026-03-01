import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError";
import { BatchModel, IBatch } from "./batch.model";
import { BatchStatus } from "../../types/common";
import { autoTransitionBatches } from "../../utils/batchScheduler";

/**
 * Generate next batch number for a course
 */
const getNextBatchNumber = async (courseId: string): Promise<number> => {
    const lastBatch = await BatchModel.findOne({ courseId })
        .sort({ batchNumber: -1 })
        .select('batchNumber');
    // Start from 1 for any new course; increment from the last batch number for existing ones
    return lastBatch ? lastBatch.batchNumber + 1 : 1;
};

export const BatchService = {
    /**
     * Create new batch with auto-generated batch number
     */
    createBatch: async (data: Partial<IBatch>) => {
        // Validate course exists
        if (!data.courseId) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Course ID is required");
        }

        // Generate batch number
        const batchNumber = await getNextBatchNumber(data.courseId.toString());

        // Validate dates
        if (data.startDate && data.endDate && data.startDate >= data.endDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "End date must be after start date");
        }

        if (data.enrollmentStartDate && data.enrollmentEndDate && data.enrollmentStartDate >= data.enrollmentEndDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Enrollment end date must be after enrollment start date");
        }

        const batch = await BatchModel.create({
            ...data,
            batchNumber,
            currentEnrollment: 0,
            status: data.status || BatchStatus.Draft,
        });

        return batch;
    },

    /**
     * Get all batches with optional filters
     */
    getAllBatches: async (filters?: {
        status?: BatchStatus;
        courseId?: string;
        upcoming?: boolean;
    }) => {
        const query: any = {};

        if (filters?.status) query.status = filters.status;
        if (filters?.courseId) query.courseId = filters.courseId;
        if (filters?.upcoming) {
            query.status = { $in: [BatchStatus.Upcoming, BatchStatus.Running] };
        }

        return await BatchModel.find(query)
            .populate('courseId')
            .populate('instructors', 'name')
            .sort({ startDate: -1 });
    },

    /**
     * Get current enrollment batch (where enrollment is open)
     */
    getCurrentEnrollmentBatch: async (courseId?: string) => {
        console.log(courseId)
        const now = new Date();
        const query: any = {
            enrollmentEndDate: { $gte: now },
        };

        if (courseId){
             query.courseId = courseId;
            }

        const batch = await BatchModel.findOne(query)
            .populate('courseId')
            .populate('instructors', 'name')
            .sort({ enrollmentStartDate: 1 }); // Get the earliest one if multiple

        return batch;
    },

    /**
     * Get batch by ID with full details
     */
    getBatchById: async (id: string) => {
        const batch = await BatchModel.findById(id)
            .populate('courseId')
            .populate('instructors');

        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Batch not found");
        }

        return batch;
    },

    /**
     * Update batch (allows manual status override)
     */
    updateBatch: async (id: string, data: Partial<IBatch>) => {
        console.log('BatchService.updateBatch called:', { id, data });

        const batch = await BatchModel.findById(id);
        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Batch not found");
        }

        // Validate date changes - convert strings to Date objects for comparison
        let newStartDate = batch.startDate;
        let newEndDate = batch.endDate;

        if (data.startDate) {
            newStartDate = typeof data.startDate === 'string' ? new Date(data.startDate) : data.startDate;
        }
        if (data.endDate) {
            newEndDate = typeof data.endDate === 'string' ? new Date(data.endDate) : data.endDate;
        }

        if (newStartDate >= newEndDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "End date must be after start date");
        }

        // Validate enrollment date changes
        let newEnrollmentStartDate = batch.enrollmentStartDate;
        let newEnrollmentEndDate = batch.enrollmentEndDate;

        if (data.enrollmentStartDate) {
            newEnrollmentStartDate = typeof data.enrollmentStartDate === 'string' ? new Date(data.enrollmentStartDate) : data.enrollmentStartDate;
        }
        if (data.enrollmentEndDate) {
            newEnrollmentEndDate = typeof data.enrollmentEndDate === 'string' ? new Date(data.enrollmentEndDate) : data.enrollmentEndDate;
        }

        if (newEnrollmentStartDate >= newEnrollmentEndDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Enrollment end date must be after enrollment start date");
        }

        // Allow admin to extend end date even for running batches
        const updated = await BatchModel.findByIdAndUpdate(id, data, {
            new: true,
            runValidators: true
        });

        console.log('BatchService.updateBatch success:', updated?._id);
        return updated;
    },

    /**
     * Manually trigger batch status transition
     */
    transitionBatchStatus: async (id: string, newStatus: BatchStatus) => {
        const batch = await BatchModel.findById(id);
        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Batch not found");
        }

        // // Validate status transition
        // const validTransitions: Record<BatchStatus, BatchStatus[]> = {
        //     [BatchStatus.Draft]: [BatchStatus.Upcoming],
        //     [BatchStatus.Upcoming]: [BatchStatus.Running, BatchStatus.Draft],
        //     [BatchStatus.Running]: [BatchStatus.Completed],
        //     [BatchStatus.Completed]: [], // Cannot transition from completed
        // };

        // if (!validTransitions[batch.status].includes(newStatus)) {
        //     throw new ApiError(
        //         StatusCodes.BAD_REQUEST,
        //         `Cannot transition from ${batch.status} to ${newStatus}`
        //     );
        // }

        batch.status = newStatus;
        await batch.save();

        return batch;
    },

    /**
     * Trigger auto-transition for all batches (admin can run manually)
     */
    runAutoTransition: async () => {
        return await autoTransitionBatches();
    },

    /**
     * Delete batch (only if no enrollments)
     */
    deleteBatch: async (id: string) => {
        const batch = await BatchModel.findById(id);
        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Batch not found");
        }

        // if (batch.currentEnrollment > 0) {
        //     throw new ApiError(
        //         StatusCodes.BAD_REQUEST, 
        //         "Cannot delete batch with active enrollments"
        //     );
        // }

        await BatchModel.findByIdAndDelete(id);
        return { message: "Batch deleted successfully" };
    },
};
