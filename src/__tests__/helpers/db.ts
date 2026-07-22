import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// Register all models to ensure populate refs work in tests
import '../../modules/User/user.model.js';
import '../../modules/Admin/admin.model.js';
import '../../modules/Instructor/instructor.model.js';
import '../../modules/Course/course.model.js';
import '../../modules/Batch/batch.model.js';
import '../../modules/Enrollment/enrollment.model.js';
import '../../modules/Payment/payment.model.js';
import '../../modules/Module/module.model.js';
import '../../modules/Progress/moduleProgress.model.js';
import '../../modules/Enrollment/enrollmentCounter.model.js';
import '../../modules/User/studentIdCounter.model.js';

let replSet: MongoMemoryReplSet;

export async function connectTestDB(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      name: 'testset',
      count: 1,
      storageEngine: 'wiredTiger',
      dbName: 'test',
    },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  
  // Pre-create collections to avoid "catalog changes" error inside transactions
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    try {
      await model.createCollection();
    } catch {
      // Collection may already exist
    }
  }
}

export async function disconnectTestDB(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
}

export async function clearTestDB(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}
