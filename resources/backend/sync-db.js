const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const userId = '7ff0d08d-1ac0-4bdd-a538-7550e1220aec';

    // Update to match Stripe
    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            subscriptionStatus: 'individual',
            stripeSubscriptionId: 'sub_1SddXPD32yLGUgxGYZDeXuMs',
            // Sync email we just found in Stripe
            email: 'titi@alashi.com'
        }
    });

    console.log("Synced User:", JSON.stringify(updated, null, 2));
}

main()
    .catch(e => { throw e })
    .finally(async () => { await prisma.$disconnect() })
