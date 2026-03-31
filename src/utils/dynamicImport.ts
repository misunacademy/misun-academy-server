import 'better-auth';
import 'better-auth/adapters/mongodb';
import 'better-auth/node';
export const dynamicImport = (specifier: string): Promise<any> => {
    return new Function("s", "return import(s)")(specifier);
};

// Vercel NFT (Node File Trace) static analysis hints
// Because dynamicImport hides the package name in a string, Vercel strips the package
// from node_modules. These requires are never executed but force Vercel to bundle them.
if (process.env.NODE_ENV === 'VERCEL_NFT_HINT') {
    // require('better-auth');
    // require('better-auth/adapters/mongodb');
    // require('better-auth/node');
}
