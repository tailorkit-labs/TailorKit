---
"@tailorkit/react": patch
---

Simplify React's useApps and useViews results to data, isPending, error, isRefetching, and fetch. Rename refetch to fetch and remove status, isFetching, isLoading, isSuccess, and isError. Background refreshes set isRefetching while retaining the available data.
