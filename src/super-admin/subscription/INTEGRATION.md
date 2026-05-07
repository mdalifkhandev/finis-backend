# Subscription Module — Integration Guide

## ফাইল গুলো কোথায় রাখবে

```
src/
└── super-admin/
    └── subscription/              ← এই folder টা তৈরি করো
        ├── dto/
        │   └── subscription.dto.ts
        ├── subscription.service.ts
        ├── subscription.controller.ts
        └── subscription.module.ts
```

---

## ১. super-admin.module.ts তে যোগ করো

```typescript
// src/super-admin/super-admin.module.ts

import { SubscriptionModule } from './subscription/subscription.module';

@Module({
  imports: [PrismaModule, SubscriptionModule],  // ← SubscriptionModule যোগ করো
  // ...বাকি সব আগের মতো
})
export class SuperAdminModule {}
```

---

## ২. app.module.ts — কোনো change লাগবে না
SuperAdminModule already import করা আছে।

---

## ৩. Company Limit Check যোগ করো

`src/admin/company/company.service.ts` এ createCompany method এ:

```typescript
// company.service.ts এর top এ import যোগ করো
import { SubscriptionService } from '../../super-admin/subscription/subscription.service';

// constructor এ inject করো
constructor(
  private prisma: PrismaService,
  private subscriptionService: SubscriptionService,  // ← যোগ করো
) {}

// createCompany method এর শুরুতে যোগ করো
async createCompany(dto: CreateCompanyDto, adminId: string, logoUrl?: string) {
  // Plan limit check
  const admin = await this.prisma.user.findUnique({
    where: { id: adminId },
    select: { tenantId: true },
  });
  if (admin?.tenantId) {
    await this.subscriptionService.checkCompanyLimit(admin.tenantId);
  }

  // বাকি আগের code...
  return this.prisma.company.create({ ... });
}
```

`admin.module.ts` এ SubscriptionModule import করো:
```typescript
import { SubscriptionModule } from '../super-admin/subscription/subscription.module';

@Module({
  imports: [PrismaModule, SubscriptionModule],
  // ...
})
```

---

## ৪. Project Limit Check যোগ করো

`src/admin/project/project.service.ts` এ createProject method এ:

```typescript
import { SubscriptionService } from '../../super-admin/subscription/subscription.service';

constructor(
  private prisma: PrismaService,
  private subscriptionService: SubscriptionService,
) {}

async createProject(dto: CreateProjectDto, adminId: string, userRole?: string) {
  // Plan limit check
  const admin = await this.prisma.user.findUnique({
    where: { id: adminId },
    select: { tenantId: true },
  });
  if (admin?.tenantId) {
    await this.subscriptionService.checkProjectLimit(admin.tenantId);
  }

  // বাকি আগের code...
}
```

---

## ৫. Geofencing Check যোগ করো

`src/admin/project/project.service.ts` এ createGeofence method এ:

```typescript
async createGeofence(projectId: string, dto: CreateGeofenceDto, userId: string, userRole: string) {
  // Geofencing plan check
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });
  if (user?.tenantId) {
    await this.subscriptionService.checkGeofencingAccess(user.tenantId);
  }

  // বাকি আগের code...
}
```

---

## API Endpoints Summary

### Super Admin (plan management)
| Method | URL | কাজ |
|--------|-----|-----|
| GET | /super-admin/subscriptions/plans | সব plan দেখা |
| POST | /super-admin/subscriptions/plans | নতুন plan তৈরি |
| PUT | /super-admin/subscriptions/plans/:id | Plan edit |
| DELETE | /super-admin/subscriptions/plans/:id | Plan delete |
| GET | /super-admin/subscriptions/tenants | সব tenant দেখা |
| POST | /super-admin/subscriptions/tenants | Admin onboard করা |
| PATCH | /super-admin/subscriptions/tenants/:id/plan | Plan change |
| PATCH | /super-admin/subscriptions/tenants/:id/status | Suspend/activate |
| DELETE | /super-admin/subscriptions/tenants/:id | Tenant delete |

### Admin (নিজের plan দেখা)
| Method | URL | কাজ |
|--------|-----|-----|
| GET | /admin/subscription/my-plan | নিজের plan + usage দেখা |

---

## POST /super-admin/subscriptions/tenants — Body Example

```json
{
  "tenantName": "ABC Construction Ltd",
  "domain": "abc-construction",
  "billingEmail": "billing@abc.com",
  "planId": "uuid-of-plan",
  "adminFullName": "John Admin",
  "adminEmail": "john@abc.com",
  "adminPassword": "SecurePass123!",
  "adminPhone": "+1234567890"
}
```

## POST /super-admin/subscriptions/plans — Body Example

```json
{
  "name": "Starter",
  "priceMonthly": 99,
  "priceYearly": 990,
  "maxCompanies": 5,
  "maxProjects": 10,
  "maxUsers": 50,
  "storageGb": 10,
  "hasGeofencing": false,
  "hasAdvancedReporting": false,
  "supportLevel": "email"
}
```
