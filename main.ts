/**
 * =============================================================================
 * Terraform CDK for the GCP Web Application Infrastructure for SumApp
 * =============================================================================
 *
 * This file defines a complete, secure, and scalable infrastructure for a
 * web application (called SumApp) on Google Cloud Platform (GCP) using the
 * Terraform CDK with TypeScript.
 *
 * The infrastructure includes:
 * - A custom Virtual Private Cloud (VPC) for network isolation.
 * - Secure firewall rules to control traffic.
 * - A managed Cloud SQL (PostgreSQL) database with a private IP.
 * - A Google Compute Engine (GCE) instance to act as a web server.
 * - A startup script to install a web server and test database connectivity.
 *
 * @author Jeremiah Summers
 * @version 0.0.1
 * @last-updated 2025-06-00
 */

import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, Fn } from "cdktf";
import { GoogleProvider } from "@cdktf/provider-google/lib/provider";
import { ComputeNetwork } from "@cdktf/provider-google/lib/compute-network";
import { ComputeSubnetwork } from "@cdktf/provider-google/lib/compute-subnetwork";
import { ComputeFirewall } from "@cdktf/provider-google/lib/compute-firewall";
import { ComputeInstance } from "@cdktf/provider-google/lib/compute-instance";
import { ComputeGlobalAddress } from "@cdktf/provider-google/lib/compute-global-address";
import { SqlDatabaseInstance } from "@cdktf/provider-google/lib/sql-database-instance";
import { ProjectService } from "@cdktf/provider-google/lib/project-service";
import { ServiceNetworkingConnection } from "@cdktf/provider-google/lib/service-networking-connection";
import { RandomProvider } from "@cdktf/provider-random/lib/provider";
import { Password } from "@cdktf/provider-random/lib/password";


class WebAppStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // #########################################################################
    // # Section 1: Provider and Variable Configuration
    // #
    // # This section sets up the providers and input variables for
    // # our stack. A provider tells Terraform which cloud API to interact
    // # with (e.g., Google Cloud). Variables allow us to parameterize the
    // # configuration, making it more reusable and secure.
    // #########################################################################

    /**
     * Configures the Google Cloud provider.
     * This resource block tells CDKTF that all subsequent resources in this
     * stack should be created within the specified GCP project and region.
     */
    new GoogleProvider(this, "google", {
      project: "rclone-drive-389318",
      region: "us-west1", // Change this to your preferred region
    });

    /**
     * Configures the Random provider.
     * This is a utility provider that is not tied to a specific cloud but allows
     * for the generation of random values. We use it here to create a strong, unique
     * password for our database instance, enhancing security.
     */
    new RandomProvider(this, "random", {});

    // #########################################################################
    // # Section 2: Networking
    // #
    // # Here, we define the foundational network layer for our application.
    // # We create a custom VPC to ensure our resources are isolated from other
    // # projects and have a dedicated, private network space.
    // #########################################################################

    /**
     * Creates a custom Virtual Private Cloud (VPC).
     * By creating our own VPC instead of using the 'default' one, we gain
     * granular control over subnets, IP ranges, and firewall rules, which
     * is a fundamental security best practice for production environments.
     */
    const vpc = new ComputeNetwork(this, "vpc", {
      name: "webapp-vpc",
      // We explicitly disable automatic subnet creation to maintain full control.
      // This ensures no default subnets are created in regions we don't intend to use.
      autoCreateSubnetworks: false,
    });

    /**
     * Creates a subnet within our custom VPC.
     * Resources like our GCE instance will be launched into this subnet.
     * It defines a specific IP range for our resources within the VPC's region.
     */
    const subnet = new ComputeSubnetwork(this, "subnet", {
      name: "webapp-subnet",
      ipCidrRange: "10.0.1.0/24",
      network: vpc.id,
      region: "us-west1",
    });

    // #########################################################################
    // # Section 3: Security (Firewall Rules)
    // #
    // # This section defines the "network security guards" for our VPC.
    // # Firewall rules control what traffic is allowed to enter or leave our
    // # instances. The principle of least privilege is applied, meaning we
    // # only open the ports that are absolutely necessary 22 (ssh), 80 (http), 443 (https).
    // #########################################################################

    /**
     * Firewall rule to allow incoming SSH traffic on port 22.
     * This is necessary for administrative access to the GCE instance.
     * SECURITY NOTE: For production, `sourceRanges` should be restricted from
     * '0.0.0.0/0' (any IP) to a specific list of trusted IP addresses or ranges
     * (e.g., your office or VPN IP).
     */
    new ComputeFirewall(this, "allow-ssh", {
      name: "allow-ssh",
      network: vpc.name,
      allow: [{
        protocol: "tcp",
        ports: ["22"],
      }],
      sourceRanges: ["0.0.0.0/0"],
    });

    /**
     * Firewall rule to allow incoming HTTP/HTTPS traffic on ports 80 and 443.
     * This is what makes our web application accessible to users on the internet.
     */
    new ComputeFirewall(this, "allow-http-https", {
      name: "allow-http-https",
      network: vpc.name,
      allow: [{
        protocol: "tcp",
        ports: ["80", "443"],
      }],
      sourceRanges: ["0.0.0.0/0"],
    });

    /**
     * Firewall rule to allow internal traffic from our subnet to the database.
     * This is a critical security rule. It ensures that only resources within
     * our application's subnet (i.e., our web server) can communicate with the
     * database on its port (5432 for PostgreSQL). The database is completely
     * firewalled off from the public internet.
     */
    new ComputeFirewall(this, "allow-internal-to-db", {
      name: "allow-internal-to-db",
      network: vpc.name,
      allow: [{
        protocol: "tcp",
        ports: ["5432"],
      }],
      // The source of allowed traffic is strictly the IP range of our subnet.
      sourceRanges: [subnet.ipCidrRange],
    });


    // #########################################################################
    // # Section 4: Database (Cloud SQL with Private IP)
    // #
    // # We provision a managed PostgreSQL database. Using a managed service
    // # like Cloud SQL offloads the operational burden of database administration.
    // # We configure it with a private IP for maximum security.
    // #########################################################################

    /**
     * Generates a secure, random password for the database administrator.
     * Using the Random provider ensures that a new, strong password is created
     * on each deployment, and we avoid hardcoding credentials in our code.
     */
    const dbPassword = new Password(this, "db-password", {
      length: 16,
      special: true,
      overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
    });

    /**
     * Enables the Cloud SQL Admin API for the project.
     * This is a mandatory prerequisite for creating and managing Cloud SQL instances.
     * Adding this resource makes the configuration self-sufficient and prevents
     * deployment errors if the API was not manually enabled beforehand.
     */
    const sqlAdminApi = new ProjectService(this, "sql-admin-api", {
      service: "sqladmin.googleapis.com",
      disableOnDestroy: false,
    });

    /**
     * Enables the Service Networking API for the project.
     * This API is a prerequisite for creating a private connection (VPC Peering)
     * between your VPC and Google-managed services like Cloud SQL.
     */
    const serviceNetworkingApi = new ProjectService(this, "servicenetworking-api", {
      service: "servicenetworking.googleapis.com",
    });

    /**
     * Allocates a dedicated IP address range for the VPC Service Peering.
     * This is required for services like Cloud SQL to communicate with resources
     * in the VPC over a private connection. Explicitly creating this range
     * provides better control over IP address management and avoids potential
     * conflicts with other services.
     */
    const privateIpRange = new ComputeGlobalAddress(this, "private-ip-range", {
        name: "webapp-vpc-peering-range",
        purpose: "VPC_PEERING",
        addressType: "INTERNAL",
        prefixLength: 16,
        network: vpc.id,
    });

    /**
     * Establishes the VPC Peering connection.
     * This resource creates the private link between our VPC and the Google
     * services network where our Cloud SQL instance resides, using the
     * IP range we explicitly allocated above.
     */
    const privateVpcConnection = new ServiceNetworkingConnection(this, "private-vpc-connection", {
      network: vpc.id,
      service: "servicenetworking.googleapis.com",
      // Use the name of the explicitly allocated IP range.
      reservedPeeringRanges: [privateIpRange.name],
      // `dependsOn` ensures the API is enabled *before* attempting the connection.
      dependsOn: [serviceNetworkingApi],
    });

    /**
     * Creates the managed Google Cloud SQL for PostgreSQL instance.
     */
    const dbInstance = new SqlDatabaseInstance(this, "webapp-db", {
      name: "webapp-db",
      databaseVersion: "POSTGRES_13",
      region: "us-west1",
      settings: {
        tier: "db-f1-micro", // A cost-effective tier for development/testing.
        ipConfiguration: {
          // By setting up a private network and NOT enabling a public IP, we ensure
          // the database is only accessible from within our VPC.
          ipv4Enabled: false,
          privateNetwork: vpc.id,
        },
      },
      // The `result` attribute of the RandomPassword resource holds the generated password.
      rootPassword: dbPassword.result,
      // Explicitly depend on the VPC peering connection to ensure the network is ready.
      dependsOn: [privateVpcConnection, sqlAdminApi],
    });

    // #########################################################################
    // # Section 5: Compute (GCE Web Server)
    // #
    // # This section defines the virtual machine that will run our web
    // # application code.
    // #########################################################################

    /**
     * Creates a Google Compute Engine (GCE) instance.
     */
    const webappInstance = new ComputeInstance(this, "webapp-instance", {
      name: "webapp-instance",
      machineType: "f1-micro",
      zone: "us-west1",
      tags: ["web"], // Tags can be used to apply firewall rules or for identification.

      bootDisk: {
        initializeParams: {
          image: "rocky-linux-9/rocky-linux-9-v20250513",
        },
      },

      // Defines the network interface for the instance.
      networkInterface: [{
        network: vpc.id,
        subnetwork: subnet.id,
        // An `accessConfig` block assigns an ephemeral public IP address,
        // allowing the instance to be reached from the internet.
        accessConfig: [{}],
      }],

      /**
       * The startup script is a powerful feature that runs automatically the
       * first time the instance boots. We use it to bootstrap our application
       * environment and perform an initial health check.
       */
      metadataStartupScript: `
        #!/bin/bash
        # Wait for the network to be fully available.
        sleep 10

        # Update package lists and install Nginx web server and PostgreSQL client.
        sudo dnf install -y nginx postgresql

        # The private IP of the database is dynamically injected into the script.
        # The database password is also securely injected.
        DB_HOST="${dbInstance.privateIpAddress}"
        DB_PASS="${dbPassword.result}"

        # Create a basic HTML page to show the results of our connectivity test.
        echo "<html><head><title>GCP Infra Test</title></head><body style='font-family: sans-serif;'>" > /var/www/html/index.html
        echo "<h1>Web App Server</h1>" >> /var/www/html/index.html
        echo "<p>Attempting to connect to database at private IP: <strong>$DB_HOST</strong>...</p>" >> /var/www/html/index.html

        # Use the psql client to test the connection. We list databases as a simple query.
        # The database password is provided via an environment variable for security.
        # All output (stdout and stderr) is redirected to the HTML file for debugging.
        PGPASSWORD="$DB_PASS" psql "sslmode=disable host=$DB_HOST user=postgres" -c "\\l" >> /var/www/html/index.html 2>&1

        # Check the exit code ($?) of the last command (psql).
        # A code of 0 means success.
        if [ $? -eq 0 ]; then
          echo "<p style='color:green; font-weight: bold;'>Database connection successful!</p>" >> /var/www/html/index.html
        else
          echo "<p style='color:red; font-weight: bold;'>Database connection failed. Check firewall rules and database status.</p>" >> /var/www/html/index.html
        fi

        echo "</body></html>" >> /var/www/html/index.html
      `,
      // Ensures the instance is only created after the database is available.
      dependsOn: [dbInstance],
    });

    // #########################################################################
    // # Section 6: Outputs
    // #
    // # Outputs display useful information to the user after the `cdktf deploy`
    // # command completes. This can include IP addresses, DNS names, etc.
    // #########################################################################

    /**
     * Outputs the public IP address of the web server.
     * This makes it easy for the user to access the newly deployed web application.
     */
    new TerraformOutput(this, "webapp_instance_ip", {
      description: "The public IP address of the web application instance.",
      // `Fn.lookup` is a safe way to access nested attributes that might not
      // be known until deployment time. We prepend 'http://' for convenience.
      value: `http://${Fn.lookup(webappInstance.networkInterface.get(0).accessConfig.get(0), "nat_ip", "")}`,
    });

    /**
     * Outputs the randomly generated database password.
     * By marking this output as `sensitive`, CDKTF will hide the value in the
     * console output to prevent accidental exposure. You can still view it
     * using the `cdktf output` command.
     */
    new TerraformOutput(this, "database_password", {
        description: "The generated password for the Cloud SQL database.",
        value: dbPassword.result,
        sensitive: true,
    });
  }
}

// The main entry point of the CDKTF application.
const app = new App();
// Instantiate our stack.
new WebAppStack(app, "gcp-webapp-typescript-detailed");
// Synthesize the TypeScript code into a Terraform JSON configuration.
app.synth();
