const { createAzureServer } = require("../server");

describe("Azure Logic & Hardening", () => {
    let server;
    let azure;

    beforeEach(() => {
        const instance = createAzureServer();
        server = instance.server;
        azure = instance.__test;
        azure.setConfig({ subscriptionId: "sub1", token: "test-token" });
    });

    const callTool = async (name, args) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe("Safety Gates", () => {
        const mutationTools = [
            "azure_vm_stop",
            "azure_vm_restart",
            "azure_app_restart_web_app"
        ];

        mutationTools.forEach(name => {
            it(`should block ${name} if not confirmed`, async () => {
                const res = await callTool(name, { name: "test", resource_group: "rg1", confirm: false });
                expect(res.isError).toBe(true);
                expect(res.content[0].text).toContain("CONFIRMATION_REQUIRED");
            });
        });
    });

    describe("Schema Validation", () => {
        it("should validate required fields in azure_configure", async () => {
            const validator = server._registeredTools["azure_configure"].inputSchema;
            const result = validator.safeParse({ token: "t1" }); // missing subscription_id
            expect(result.success).toBe(false);
        });
    });
});
