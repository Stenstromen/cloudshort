declare namespace Cloudflare {
  interface Env {
    LINKS: KVNamespace;
    AUTH_KEY: string;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
