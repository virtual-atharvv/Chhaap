import { buildServer } from './server.js';
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const app = await buildServer();
app.listen({ port: PORT, host: HOST }, (err, address) => {
    if (err) {
        console.error('Server failed to start:', err);
        process.exit(1);
    }
    console.log(`[Chhaap API] Server running at ${address}`);
    console.log(`[Customer PWA] http://localhost:${PORT}/s/campus-xerox`);
    console.log(`[Shop Dashboard] http://localhost:${PORT}/shop/campus-xerox`);
});
//# sourceMappingURL=index.js.map