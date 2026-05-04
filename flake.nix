{
  description = "vite-devtools-svelte development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.git
          ];

          # Use corepack (bundled with Node 24) to install the exact pnpm
          # version pinned in package.json's `packageManager` field, so every
          # contributor gets the same package manager regardless of host nix.
          shellHook = ''
            export COREPACK_HOME="$PWD/.corepack"
            mkdir -p "$COREPACK_HOME/bin"
            corepack enable --install-directory "$COREPACK_HOME/bin" >/dev/null 2>&1 || true
            export PATH="$COREPACK_HOME/bin:$PATH"
          '';
        };
      }
    );
}
