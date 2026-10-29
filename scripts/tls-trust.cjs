/** Trust the operating system's configured CAs without disabling TLS checks. */
const tls = require("node:tls");

function trustedCertificates() {
  if (typeof tls.getCACertificates !== "function") return undefined;
  return [...new Set([
    ...tls.getCACertificates("default"),
    ...tls.getCACertificates("system"),
  ])];
}

function tlsRequestOptions() {
  const ca = trustedCertificates();
  return ca ? { ca } : {};
}

function configureSystemTrust() {
  if (typeof tls.setDefaultCACertificates !== "function") return;
  const certificates = trustedCertificates();
  if (certificates) tls.setDefaultCACertificates(certificates);
}

function explainNetworkError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/self.signed certificate|unable to (?:get local issuer|verify.*certificate)|certificate (?:has expired|verify failed)|CERT_(?:HAS_EXPIRED|AUTHORITY_INVALID)|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(message)) {
    return new Error(
      "Studio could not verify the network certificate. Check the computer's date and trusted certificates. If your network uses a proxy, ask its administrator to install the proxy's trusted CA certificate, then restart Studio. Your environment files have been preserved.",
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error(message);
}

module.exports = { configureSystemTrust, tlsRequestOptions, explainNetworkError };
