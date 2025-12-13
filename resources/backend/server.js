const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Flocca Backend Vault running on port ${PORT}`);
    console.log(`Encryption Key Loaded: ${process.env.ENCRYPTION_KEY ? 'Yes' : 'No'}`);
    console.log(`Database URL: ${process.env.DATABASE_URL}`);
});
