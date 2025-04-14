# Description: This script is used to build the ORT website.

# Clear the npm cache
npm cache clean --force

# file="package-lock.json"
# if [ -f "$file" ] ; then
#     rm "$file"
# fi

# Run the setup script
npm run setup

# # Verify the setup
# npm run verify-setup

# Build the website
npm run dev