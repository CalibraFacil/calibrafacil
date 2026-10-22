import { defineGroup, example, text, url } from "../define.ts";

export const storageGroup = defineGroup({
  name: "storage",
  title: "Object storage (S3-compatible)",
  intro: [
    "Locally: the S3 container from docker-compose.yml. On Cloudflare R2, remove",
    "R2_ENDPOINT/R2_REGION and set R2_ACCOUNT_ID instead. Production needs one of",
    "R2_ACCOUNT_ID or R2_ENDPOINT.",
  ],
  vars: {
    accountId: text({
      env: "R2_ACCOUNT_ID",
      description:
        "Cloudflare R2 account id; the S3 endpoint is derived from it unless R2_ENDPOINT is set.",
      example: example.commented(""),
    }),
    endpoint: url({
      env: "R2_ENDPOINT",
      description:
        "S3-compatible endpoint of any non-R2 store (the local container, MinIO, AWS S3). Takes precedence over R2_ACCOUNT_ID.",
      example: example.active("http://localhost:59000"),
    }),
    publicEndpoint: url({
      env: "R2_PUBLIC_ENDPOINT",
      description:
        "The store's public address, when R2_ENDPOINT is an internal one: download links are signed for it.",
    }),
    region: text({
      env: "R2_REGION",
      description:
        "S3 region (default us-east-1 with R2_ENDPOINT, auto on R2).",
      example: example.active("us-east-1"),
    }),
    accessKeyId: text({
      env: "R2_ACCESS_KEY_ID",
      description: "Object-storage access key id.",
      secret: true,
      requiredInProduction: ["api", "worker"],
      example: example.active("calibra"),
    }),
    secretAccessKey: text({
      env: "R2_SECRET_ACCESS_KEY",
      description: "Object-storage secret access key.",
      secret: true,
      requiredInProduction: ["api", "worker"],
      example: example.active("calibra-dev-secret"),
    }),
    bucketName: text({
      env: "R2_BUCKET_NAME",
      description:
        "Documents bucket: regulated records (certificates, service-order documents, standards).",
      requiredInProduction: ["api", "worker"],
      example: example.active("calibra-documents"),
    }),
    mediaBucketName: text({
      env: "R2_MEDIA_BUCKET_NAME",
      description:
        "Media bucket: branding and media (logos, signatures, avatars).",
      requiredInProduction: ["api", "worker"],
      example: example.active("calibra-media"),
    }),
  },
});

export const renderingGroup = defineGroup({
  name: "rendering",
  title: "PDF rendering (Gotenberg)",
  vars: {
    gotenbergUrl: url({
      env: "GOTENBERG_URL",
      description:
        "Gotenberg service that renders HTML and spreadsheets to PDF.",
      example: example.active("http://localhost:3001"),
    }),
    gotenbergToken: text({
      env: "GOTENBERG_TOKEN",
      description:
        "Shared-secret header, only when your Gotenberg sits behind the token gate in services/gotenberg.",
      secret: true,
    }),
  },
});
