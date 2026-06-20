"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    resolve: {
        alias: {
            '@modules': '/src/modules',
            '@common': '/src/common',
            '@config': '/src/config',
            '@queues': '/queues'
        }
    },
    test: {
        environment: 'node',
        pool: 'vmForks',
        include: ['src/**/*.security.test.ts'],
        coverage: {
            enabled: false
        }
    }
});
