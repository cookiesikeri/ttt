const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor, AlwaysOnSampler } = require('@opentelemetry/sdk-trace-base');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const axios = require('axios'); // Add axios for HTTP calls

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE);

const jaegerExporter = new JaegerExporter({
    endpoint: 'http://jaeger-collector.bankly.svc.cluster.local:14268/api/traces',
    onSuccess: (data) => {
        console.log('✅ Traces sent to Jaeger successfully:', data);
    },
    onError: (error) => {
        console.error('❌ Error sending traces to Jaeger:', error);
    }
});

const sdk = new NodeSDK({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'devtestv2',
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [new BatchSpanProcessor(jaegerExporter)],
    instrumentations: [getNodeAutoInstrumentations()],
    sampler: new AlwaysOnSampler(),
});

console.log('Initializing OpenTelemetry SDK...');
sdk.start();
console.log('OpenTelemetry SDK initialized.');

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    console.log('Request received for / endpoint');
    res.json({ message: 'Hello from Bankly service!' });
});

app.get('/api/users', async(req, res) => {
    console.log('Request received for /api/users endpoint');
    try {
        await new Promise(resolve => setTimeout(resolve, 200));
        res.json({ users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/transactions', async(req, res) => {
    console.log('Request received for /api/transactions endpoint');
    try {
        await new Promise(resolve => setTimeout(resolve, 350));
        res.json({
            transactions: [
                { id: 'txn-001', amount: 1250.00, status: 'completed' },
                { id: 'txn-002', amount: 795.50, status: 'pending' }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

const { trace } = require('@opentelemetry/api');

// New endpoint to call another service
app.get('/api/call-identity', async(req, res) => {
    const tracer = trace.getTracer('devtestv2-tracer');
    const span = tracer.startSpan('call-identity-span');
    span.setAttribute('http.method', 'GET');
    try {
        console.log('Calling Bankly-Identity-MS...');
        const response = await axios.get('http://bankly-identity-ms.bankly.svc.cluster.local:80/', {
            headers: {
                'X-Custom-Header': 'devtestv2' // Optional: for debugging
            }
        });
        span.setAttribute('http.status_code', response.status);
        res.json({ message: 'Called Bankly-Identity-MS', data: response.data });
    } catch (error) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', error.message);
        res.status(500).json({ error: 'Failed to call Bankly-Identity-MS' });
    } finally {
        span.end();
    }
});

app.get('/api/manual-trace', async(req, res) => {
    console.log('Creating a manual trace...');
    const tracer = trace.getTracer('manual-tracer');
    const span = tracer.startSpan('manual-root-span');
    span.setAttribute('custom.attribute', 'test-value');
    await new Promise(resolve => setTimeout(resolve, 100));
    const childSpan = tracer.startSpan('manual-child-span', { parent: span });
    childSpan.setAttribute('another.attribute', 'child-value');
    await new Promise(resolve => setTimeout(resolve, 50));
    childSpan.end();
    span.end();
    console.log('Manual traces created and ended');
    res.json({ message: 'Manual traces created and sent' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    sdk.shutdown()
        .then(() => console.log('Tracing terminated'))
        .catch((error) => console.log('Error terminating tracing', error))
        .finally(() => process.exit(0));
});