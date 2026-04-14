const { createAzureServer } = require("./resources/servers/azure/server");
const instance = createAzureServer();
const tool = instance.server._registeredTools["azure_configure"];
console.log("Tool keys:", Object.keys(tool));
if (tool.config) console.log("Config keys:", Object.keys(tool.config));
else console.log("No config property");
