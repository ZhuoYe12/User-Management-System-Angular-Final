require('rootpath')();
require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const errorHandler = require('./_middleware/error_handler');
const http = require('http');
const db = require('./_helpers/db');

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';
const port = isProduction ? (process.env.PORT || 80) : 4000;
const allowedOrigins = [
    'https://user-management-system-angular.vercel.app',
    'https://user-management-system-angular-tm8z.vercel.app',
    'https://user-management-system-angular-froillan123.vercel.app',
    'http://localhost:4200',
    'http://localhost:3000',
    'http://127.0.0.1:4200'
];

// Parse JSON and URL-encoded data
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

// CORS configuration
app.use((req, res, next) => {
    // Log the origin for debugging
    console.log(`Request origin: ${req.headers.origin}`);
    next();
});

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, etc)
        if (!origin) return callback(null, true);
        
        // Check if the origin is allowed
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`CORS blocked request from: ${origin}`);
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Add additional headers to handle preflight requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// Handle OPTIONS preflight requests
app.options('*', (req, res) => {
    res.sendStatus(200);
});

// Automatic workflow cleanup on server startup
console.log('Initializing automatic workflow cleanup...');
setTimeout(async () => {
    try {
        const workflowCleanup = require('./_helpers/workflow-cleanup');
        await workflowCleanup.cleanupAllDuplicateWorkflows();
        console.log('Automatic workflow cleanup completed successfully');
    } catch (error) {
        console.error('Error during automatic workflow cleanup:', error);
    }
}, 3000); // Wait for DB initialization before running cleanup

// API routes - wrap in try/catch to isolate errors
try {
    console.log('Loading accounts controller...');
    const accountsController = require('./accounts/accounts.controller');
    app.use('/accounts', accountsController);
    console.log('Accounts controller loaded successfully');
    
    console.log('Loading analytics controller...');
    const analyticsController = require('./accounts/analytics.controller');
    app.use('/accounts/analytics', analyticsController);
    console.log('Analytics controller loaded successfully');
    
    console.log('Loading employees controller...');
    const employeesController = require('./employees/index');
    app.use('/employees', employeesController);
    console.log('Employees controller loaded successfully');
    
    console.log('Loading departments controller...');
    const departmentsController = require('./departments/index');
    app.use('/departments', departmentsController);
    console.log('Departments controller loaded successfully');
    
    console.log('Loading requests controller...');
    const requestsController = require('./requests/index');
    app.use('/requests', requestsController);
    console.log('Requests controller loaded successfully');

    console.log('Loading workflows controller...');
    try {
        const workflowsController = require('./workflows/index');
        app.use('/workflows', workflowsController);
        console.log('Workflows controller loaded successfully');
    } catch (error) {
        console.error('Error loading workflows controller:', error);
        // Create a default workflows controller if the module doesn't exist
        const express = require('express');
        const workflowsRouter = express.Router();
        const db = require('./_helpers/db');
        const authorize = require('./_middleware/authorize');
        
        // GET all workflows
        workflowsRouter.get('/', authorize(), async (req, res, next) => {
            try {
                const workflows = await db.Workflow.findAll({
                    include: [{ model: db.Employee }]
                });
                res.json(workflows);
            } catch (err) { next(err); }
        });
        
        // GET workflows by employee ID
        workflowsRouter.get('/employee/:employeeId', authorize(), async (req, res, next) => {
            try {
                const workflows = await db.Workflow.findAll({
                    where: { employeeId: req.params.employeeId },
                    order: [['created', 'DESC']]
                });
                res.json(workflows);
            } catch (err) { next(err); }
        });
        
        // GET workflow by ID
        workflowsRouter.get('/:id', authorize(), async (req, res, next) => {
            try {
                const workflow = await db.Workflow.findByPk(req.params.id);
                if (!workflow) throw new Error('Workflow not found');
                res.json(workflow);
            } catch (err) { next(err); }
        });
        
        // CREATE workflow
        workflowsRouter.post('/', authorize(), async (req, res, next) => {
            try {
                const workflow = await db.Workflow.create(req.body);
                res.status(201).json(workflow);
            } catch (err) { next(err); }
        });
        
        // UPDATE workflow status
        workflowsRouter.put('/:id/status', authorize(), async (req, res, next) => {
            try {
                const workflow = await db.Workflow.findByPk(req.params.id);
                if (!workflow) throw new Error('Workflow not found');
                
                await workflow.update({ status: req.body.status });
                res.json(workflow);
            } catch (err) { next(err); }
        });
        
        // UPDATE entire workflow
        workflowsRouter.put('/:id', authorize(), async (req, res, next) => {
            try {
                const workflow = await db.Workflow.findByPk(req.params.id);
                if (!workflow) throw new Error('Workflow not found');
                
                // Update workflow preserving the ID and created date
                const { id, created, ...updateData } = req.body;
                await workflow.update(updateData);
                
                res.json(workflow);
            } catch (err) { next(err); }
        });
        
        app.use('/workflows', workflowsRouter);
        console.log('Created default workflows controller');
    }
} catch (error) {
    console.error('Error loading controllers:', error);
    process.exit(1);
}

// Swagger docs route - disabled to avoid path-to-regexp errors
app.use('/api-docs', (req, res) => {
    res.status(503).send('API Documentation temporarily unavailable due to path-to-regexp issues');
});

// Global error handler
app.use(errorHandler);

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with safeguards
try {
    console.log('Initializing Socket.IO...');
    const socketModule = require('./_helpers/socket');
    socketModule.init(server);
    console.log('Socket.IO initialized successfully');
} catch (error) {
    console.error('Error initializing Socket.IO:', error);
}

// Check for path-to-regexp version
try {
    const pathToRegexp = require('path-to-regexp');
    console.log('path-to-regexp version:', require('path-to-regexp/package.json').version);
} catch (error) {
    console.error('Could not determine path-to-regexp version:', error.message);
}

// Log environment information
console.log(`Server running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
console.log(`Server listening on port ${port}`);
console.log(`API Documentation temporarily disabled`);
console.log(`WebSocket server initialized`);

server.listen(port);