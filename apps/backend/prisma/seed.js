const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const USERS = [
  { username: 'arzaka', password: 'arzaka22' },
  { username: 'hamooy', password: 'hamooy4321' },
  { username: 'zahara', password: 'zazuai321' },
];

async function main() {
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (existing) {
      console.log(`User ${u.username} sudah ada, skip.`);
      continue;
    }
    const hashed = await bcrypt.hash(u.password, 10);
    await prisma.user.create({ data: { username: u.username, password: hashed } });
    console.log(`Seeded user: ${u.username}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
