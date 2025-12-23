# Use the official Node.js image with LTS (Long Term Support) version
FROM node:lts-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if available) to the working directory
COPY package.json ./
COPY package-lock.json* ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code to the working directory
COPY . .

# Expose the port on which your application runs
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
