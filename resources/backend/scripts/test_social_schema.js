const prisma = require('../src/db') || new (require('@prisma/client').PrismaClient)();

async function runSocialSchemaTest() {
    try {
        console.log('--- Social Schema Verification ---');
        const id = 'social-test-' + Date.now();

        console.log('Attempting to create user with githubId...');
        const user = await prisma.user.create({
            data: {
                id,
                githubId: 'gh_12345',
                email: `gh-${Date.now()}@test.com`
            }
        });

        console.log('✅ Success! User created with githubId:', user.githubId);

        // Clean up
        await prisma.user.delete({ where: { id } });

    } catch (e) {
        console.error('❌ Schema Verification Failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

runSocialSchemaTest();
