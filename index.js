const Hapi = require('hapi');
const functionHelper = require('serverless-offline/src/functionHelper');

class LambdaOfflineWebpack {
    constructor(serverless, options) {
        this.service = serverless.service;
        this.options = options;
        this.serverless = serverless;
        this.serverlessLog = serverless.cli.log.bind(serverless.cli);

        this.hooks = {
            'before:offline:start:init': this.start.bind(this),
        };
    }

    start() {
        this.buildServer();
    }

    log(message) {
        this.serverlessLog(message);
    }

    buildServer() {
        this.server = new Hapi.Server();
        this.server.connection({ port: 4000, host: 'localhost' });

        let { servicePath } = this.serverless.config;

        if (this.serverless.service.plugins.includes('serverless-webpack')) {
            servicePath = `${servicePath}/.webpack/service`;
        }

        const serviceRuntime = this.service.provider.runtime;
        const handlers = Object.keys(this.service.functions).reduce((acc, key) => {
            const fun = this.service.getFunction(key);
            const funOptions = functionHelper.getFunctionOptions(fun, key, servicePath, serviceRuntime);
            const handler = functionHelper.createHandler(funOptions, {});
            acc[fun.name] = handler;
            return acc;
        }, {});

        this.server.route({
            method: 'POST',
            path: '/2015-03-31/functions/{functionName}/invocations',
            config: {
                handler: (req, reply) => {
                    const invocationType = req.headers['x-amz-invocation-type'];
                    const { functionName } = req.params;

                    const handler = handlers[functionName];

                    if (!handler) {
                        return reply().code(404);
                    }
                    const { payload } = req;

                    let body = '';
                    payload.on('data', (chunk) => {
                        body += chunk;
                    });

                    return payload.on('end', () => {
                        const event = JSON.parse(body);
                        this.serverlessLog(`Invoke (λ: ${functionName})`);
                        if (invocationType === 'Event') {
                            handler(event, null, () => {});
                            reply().code(202);
                        } else {
                            const done = (res) => {
                                reply(JSON.stringify(res)).code(202);
                            };
                            const result = handler(event, null, done);

                            if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                                result.then(done);
                            }
                        }
                    });
                },
                payload: {
                    output: 'stream',
                    parse: false,
                },
            },
        });

        this.server.start().then(() => this.log(`Offline Lambda Webpack Server listening on ${this.server.info.uri}`));
    }
}

module.exports = LambdaOfflineWebpack;
