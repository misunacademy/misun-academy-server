import mongoose from 'mongoose';
import config from '../config/env.js';
import { DigitalProductModel } from '../modules/DigitalProduct/digitalProduct.model.js';
import { logger } from '../config/logger.js';

const initialProducts = [
    {
        title: 'ফটোশপ সুপার শর্টকাট স্ক্রিপ্ট প্যাক',
        slug: 'photoshop-super-shortcut-script',
        tagline: 'ডিজাইন ও এডিটিংয়ের কাজকে করুন ৫ গুণ দ্রুত — মাত্র এক ক্লিকে অটোমেশন!',
        description:
            'ফটোশপে বারবার করা রুটিন কাজগুলো যেমন লেয়ার সাজানো, দ্রুত সাইজিং, অটো-মাস্কিং ও ব্যাচ এক্সপোর্ট করার জন্য বিশেষভাবে তৈরি শর্টকাট স্ক্রিপ্ট। সাথে পাচ্ছেন বাংলায় সহজ ইনস্টলেশন গাইড।',
        software: 'photoshop',
        priceBDT: 500,
        discountPriceBDT: 250,
        priceINR: 399,
        discountPriceINR: 199,
        thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
        badge: 'বেস্টসেলার',
        features: [
            '১-ক্লিকে যেকোনো ডিজাইন অপ্টিমাইজড এক্সপোর্ট',
            'স্মার্ট লেয়ার অর্গানাইজেশন ও অটো অ্যালাইনমেন্ট',
            'ফটোশপ CC 2020 থেকে 2026 পর্যন্ত শতভাগ কম্প্যাটিবল',
            'সহজ ও বিস্তারিত ইনস্টলেশন গাইড (বাংলা PDF)',
        ],
        scriptFile: {
            fileName: 'Photoshop-Super-Shortcuts.jsx',
            url: 'https://assets.misunacademy.com/scripts/photoshop-super-shortcuts.jsx',
            fileSize: '1.2 MB',
        },
        guidePdf: {
            fileName: 'Photoshop-Script-Installation-Guide.pdf',
            url: 'https://assets.misunacademy.com/guides/photoshop-script-guide.pdf',
            fileSize: '2.4 MB',
        },
        isPublished: true,
    },
    {
        title: 'ইলাস্ট্রেটর প্রফেশনাল শর্টকাট স্ক্রিপ্ট প্যাক',
        slug: 'illustrator-pro-shortcut-script',
        tagline: 'ভেক্টর ডিজাইনিং ও আর্টবোর্ড ম্যানেজমেন্ট করুন চোখের পলকে!',
        description:
            'লোগো, ব্র্যান্ডিং ও ভেক্টর ইলাস্ট্রেশনে আর্টবোর্ড হ্যান্ডলিং, ভেক্টর পাথ ক্লিনআপ এবং কালার রিপ্লেসমেন্ট অটোমেট করার বিশেষ স্ক্রিপ্ট কোড।',
        software: 'illustrator',
        priceBDT: 500,
        discountPriceBDT: 250,
        priceINR: 399,
        discountPriceINR: 199,
        thumbnail: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800&auto=format&fit=crop&q=80',
        badge: 'জনপ্রিয়',
        features: [
            'এক ক্লিকে মাল্টিপল আর্টবোর্ড ক্লিনিং ও অটো রিনেম',
            'অতিরিক্ত ভেক্টর পয়েন্ট ক্লিনআপ ও ফাইল সাইজ কমানো',
            'ইলাস্ট্রেটর CC 2020 থেকে 2026 পর্যন্ত কার্যকর',
            'স্টেপ-বাই-স্টেপ স্ক্রিনশটসহ ইনস্টলেশন গাইড (বাংলা PDF)',
        ],
        scriptFile: {
            fileName: 'Illustrator-Pro-Shortcuts.jsx',
            url: 'https://assets.misunacademy.com/scripts/illustrator-pro-shortcuts.jsx',
            fileSize: '1.4 MB',
        },
        guidePdf: {
            fileName: 'Illustrator-Script-Installation-Guide.pdf',
            url: 'https://assets.misunacademy.com/guides/illustrator-script-guide.pdf',
            fileSize: '2.8 MB',
        },
        isPublished: true,
    },
    {
        title: 'আলটিমেট ডিজাইনার কম্বো প্যাক (Ps + Ai)',
        slug: 'ultimate-designer-combo-pack',
        tagline: 'ফটোশপ ও ইলাস্ট্রেটর দুটি স্ক্রিপ্ট প্যাকই একসাথে — সেরা অফার মূল্যে!',
        description:
            'আপনার ডিজাইনিং ওয়ার্কফ্লোকে প্রফেশনাল লেভেলে নিয়ে যাওয়ার জন্য ফটোশপ ও ইলাস্ট্রেটরের কমপ্লিট স্ক্রিপ্ট বান্ডেল ও গাইড একসাথে।',
        software: 'bundle',
        priceBDT: 900,
        discountPriceBDT: 399,
        priceINR: 700,
        discountPriceINR: 349,
        thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
        badge: 'বেস্ট ভ্যালু (Save 55%)',
        features: [
            'ফটোশপ ও ইলাস্ট্রেটর দুটি স্ক্রিপ্ট ফাইলই একসাথে',
            'দুটি সফটওয়্যারের সম্পূর্ণ ইনস্টলেশন ও ইউজার গাইড (PDF)',
            'লাইফটাইম এক্সেস ও আনলিমিটেড ডাউনলোড সুবিধা',
            'ক্লায়েন্ট প্রজেক্ট দ্রুত সম্পন্ন করে বেশি আয় করার সিক্রেট গাইড',
        ],
        scriptFile: {
            fileName: 'Designer-Shortcuts-Bundle.zip',
            url: 'https://assets.misunacademy.com/scripts/designer-shortcuts-bundle.zip',
            fileSize: '3.1 MB',
        },
        guidePdf: {
            fileName: 'Complete-Design-Scripts-Manual.pdf',
            url: 'https://assets.misunacademy.com/guides/complete-design-scripts-manual.pdf',
            fileSize: '4.5 MB',
        },
        isPublished: true,
    },
];

async function seed() {
    try {
        await mongoose.connect(config.MONGO_URI);
        logger.info('Connected to MongoDB');

        for (const item of initialProducts) {
            await DigitalProductModel.findOneAndUpdate(
                { slug: item.slug },
                { $set: item },
                { upsert: true, new: true }
            );
            logger.info(`Upserted digital product: ${item.slug}`);
        }

        logger.info('Digital products seeded successfully.');
        process.exit(0);
    } catch (err) {
        logger.error({ err }, 'Error seeding digital products');
        process.exit(1);
    }
}

seed();
