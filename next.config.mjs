/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: { '/api/**': ['./data/**'] },
};
export default nextConfig;
