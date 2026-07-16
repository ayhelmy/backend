const app = require('../src/app');
console.log(typeof app);
console.log(app && app.listen ? 'has-listen' : 'no-listen');
console.log(app && app.handle ? 'has-handle' : 'no-handle');
console.log(app && app._router ? 'has-router' : 'no-router');
