"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../src/generated/prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const bcrypt = __importStar(require("bcryptjs"));
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    console.log('🌱 Seeding database...');
    const passwordHash = await bcrypt.hash('123456', 10);
    const users = [
        {
            email: 'superadmin@gmail.com',
            fullName: 'Super Admin',
            passwordHash,
            role: client_1.UserRole.super_admin,
            status: client_1.UserStatus.active,
            phone: '+10000000001',
        },
        {
            email: 'admin1@gmail.com',
            fullName: 'Admin One',
            passwordHash,
            role: client_1.UserRole.admin,
            status: client_1.UserStatus.active,
            phone: '+10000000002',
        },
        {
            email: 'manager1@gmail.com',
            fullName: 'Manager One',
            passwordHash,
            role: client_1.UserRole.manager,
            status: client_1.UserStatus.active,
            phone: '+10000000003',
        },
        {
            email: 'worker1@gmail.com',
            fullName: 'Worker One',
            passwordHash,
            role: client_1.UserRole.worker,
            status: client_1.UserStatus.active,
            phone: '+10000000004',
        },
    ];
    for (const user of users) {
        const existing = await prisma.user.findUnique({
            where: { email: user.email },
        });
        if (!existing) {
            await prisma.user.create({
                data: user,
            });
            console.log(`✅ Created ${user.role}: ${user.email}`);
        }
        else {
            await prisma.user.update({
                where: { email: user.email },
                data: {
                    passwordHash,
                    role: user.role,
                    status: user.status,
                },
            });
            console.log(`🔄 Updated ${user.role}: ${user.email}`);
        }
    }
    console.log('🎉 Seeding completed successfully!');
}
main()
    .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
//# sourceMappingURL=seed.js.map