import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { BootcampCatalogModel } from '../modules/Bootcamp/bootcampCatalog.model.js';
import { BootcampStatus, RecordedStatus } from '../modules/Bootcamp/bootcampCatalog.interface.js';

dotenv.config();

const seed = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI missing');
    await mongoose.connect(uri);

    const slug = 'paracetamol-for-photoshop-season-2';
    const existing = await BootcampCatalogModel.findOne({ slug }).lean();
    if (existing) {
        console.log('Bootcamp already seeded:', slug);
        await mongoose.disconnect();
        return;
    }

    await BootcampCatalogModel.create({
        title: 'প্যারাসিটামল ফর ফটোশপ',
        season: 'Season 2.0',
        slug,
        tagline: '৪-দিনের অ্যাডভান্সড গ্রাফিক ডিজাইন বুটক্যাম্প',
        description: 'অ্যাডভান্সড ডিজাইন, পোর্টফোলিও, ক্লায়েন্ট হান্টিং, গিফট ও ইন্টার্নশিপ।',
        status: BootcampStatus.Upcoming,
        startDate: new Date('2026-09-13T15:00:00Z'),
        endDate: new Date('2026-09-16T16:00:00Z'),
        time: 'প্রতিদিন রাত ৯টা',
        platform: 'সম্পূর্ণ অনলাইনে (Zoom)',
        liveFee: 350,
        recordedPrice: 499,
        recordedStatus: RecordedStatus.Draft,
        thumbnail: '',
        posterImage: '',
        perks: [
            { title: 'অ্যাডভান্সড ডিজাইন', description: 'বেসিক টুলস পেরিয়ে রিয়েল-ওয়ার্ল্ড প্রজেক্টের মতো ডিজাইন করা শিখুন।' },
            { title: 'পোর্টফোলিও', description: 'ক্লায়েন্টকে দেখানোর মতো নিজের পোর্টফোলিও সাজানোর গাইডলাইন।' },
            { title: 'ক্লায়েন্ট হান্টিং', description: 'মার্কেটপ্লেস ও সোশ্যাল মিডিয়া থেকে কাজ পাওয়ার কৌশল।' },
            { title: 'গিফট', description: 'টপ থ্রি স্টুডেন্ট এর জন্য স্পেশাল গিফট।' },
            { title: 'ইন্টার্নশিপ', description: 'সেরা পারফর্মারের জন্য এক মাসের পেড ইন্টার্নশিপ।' },
        ],
        schedule: [
            { day: 'দিন ০১', dose: '৫০০ মি.গ্রা.', title: 'অ্যাডভান্সড ডিজাইন', description: 'পোস্টার, সোশ্যাল মিডিয়া ক্রিয়েটিভসহ রিয়েল প্রজেক্ট প্র্যাকটিস।' },
            { day: 'দিন ০২', dose: '৫০০ মি.গ্রা.', title: 'পোর্টফোলিও বিল্ডিং', description: 'আপনার কাজ যেভাবে উপস্থাপন করলে ক্লায়েন্ট নজরে রাখবে।' },
            { day: 'দিন ০৩', dose: '৫০০ মি.গ্রা.', title: 'ক্লায়েন্ট হান্টিং', description: 'প্রথম ক্লায়েন্ট পাওয়ার রোডম্যাপ ও ইন্টার্নশিপ গাইডলাইন।' },
            { day: 'দিন ০৪', dose: '৫০০ মি.গ্রা.', title: 'গিফট & ইন্টার্নশিপ', description: 'টপ থ্রি গিফট ও সেরা পারফর্মারের পেড ইন্টার্নশিপ।' },
        ],
        faq: [
            { question: 'পেমেন্ট কীভাবে করব?', answer: 'বিকাশ বা নগদে ৩৫০ টাকা সেন্ড মানি করে ফর্মে শেষ ৪ ডিজিট দিন।' },
            { question: 'রেকর্ডিং কি পরে কিনতে পারব?', answer: 'হ্যাঁ — লাইভ শেষে /bootcamp পেজে রেকর্ডিং কার্ড থেকে যেকোনো সময় কিনতে পারবেন।' },
        ],
        paymentMethods: [
            { label: 'বিকাশ', number: '01402409710', type: 'সেন্ড মানি' },
            { label: 'নগদ', number: '01758689064', type: 'সেন্ড মানি' },
            { label: 'ফোনপে', number: '9123944746', type: 'সেন্ড মানি' },
        ],
        registrationOpen: true,
        lessonsCount: 0,
        durationMinutes: 0,
    });

    console.log('Bootcamp seeded:', slug);
    await mongoose.disconnect();
};

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
