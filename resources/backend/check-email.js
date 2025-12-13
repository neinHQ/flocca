const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({
        where: { email: 'titi@alashi.com' }
    });
    console.log(JSON.stringify(user, null, 2));
}

main()
    .catch(e => { throw e })
    .finally(async () => { await prisma.$disconnect() })
