#pragma once

// TLS root certificate for your MQTT broker (PEM format as a C string).
// Replace the content below with your broker's CA certificate.

const char* CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
<paste your broker CA certificate here>
-----END CERTIFICATE-----
)EOF";
