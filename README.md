# SumApp – GCP Infrastructure with Terraform CDK (TypeScript)

This project sets up foundational cloud infrastructure for a simple web application using Terraform CDK with TypeScript. The goal was to provision compute and database resources in Google Cloud Platform (GCP) while limiting scope to 2 hours, per the Couchsurfing Cloud Engineer coding exercise.

---

## What It Builds

- A custom VPC with public and private subnets
- A Google Compute Engine (GCE) VM in a private subnet
- A Cloud SQL (PostgreSQL) managed instance
- Routing and firewall rules to allow secure communication between the VM and DB
- An HTTP(S) Load Balancer exposing the app VM publicly

---

## High-Level Architecture Diagram (not all resources are created)

```

```
                    +--------------------------+
                    |     Public Internet      |
                    +------------+-------------+
                                 |
                        HTTPS Load Balancer
                                 |
                     +-----------+------------+
                     |       Public Subnet     |
                     |   (NAT Gateway, LB IP)   |
                     +-----------+-------------+
                                 |
                    +------------v-------------+
                    |      Private Subnet      |
                    |      GCE App Server      |
                    +------------+-------------+
                                 |
                    +------------v-------------+
                    |      Cloud SQL (Postgres)|
                    +--------------------------+
```

````

---

## Deployment Instructions

### Prerequisites
- Node.js (>= 16.x)
- Terraform CDK (install with `npm install -g cdktf-cli`)
- GCP account with:
  - Project ID
  - Service account with necessary IAM roles
  - Application default credentials (`gcloud auth application-default login`)
- Terraform CLI

---

### 1. Install dependencies

```bash
sudo npm install -g cdktf-cli
````

---

### 2. Bootstrap CDK project

```bash
cdktf init --template=typescript --local
```

*Already completed in this repo, but included for completeness.*

---

### 3. Synthesize Terraform JSON

```bash
cdktf synth
```

---

### 4. Deploy infrastructure

```bash
cdktf deploy
```

---

### 5. Destroy resources (when done)

```bash
cdktf destroy
```

---

## Trade-offs and Design Notes

### Time Constraints

The entire project was built under a \~2-hour time limit. As such, decisions were made to prioritize essential elements of the stack over optional/advanced features.

### Security

* VM lives in a private subnet to avoid direct exposure
* Communication with the DB is only allowed from the VM’s IP range
* IAM roles were kept minimal and explicit for principle of least privilege

---

## Next Steps (Given More Time)

1. **Auto Scaling:**

   * Use instance groups and managed instance templates
   * Add load balancer backend service with health checks

2. **Secrets Management:**

   * Use Secret Manager to securely inject DB credentials and other secrets

3. **CI/CD Integration:**

   * Add GitHub Actions or GCP Cloud Build pipeline
   * Automatically deploy infra or test changes on PR

4. **Monitoring & Observability:**

   * Enable GCP's Cloud Monitoring and Logging
   * Set up basic alerting policies

5. **Basic Test App:**

   * Deploy a small Express.js or Flask app that connects to the DB and shows connection status

---

## Related Projects

You can also view prior work at my alternate (now inaccessible) GitHub account:
**[https://github.com/jmiahman](https://github.com/jmiahman)**

---

## License

MIT – use and adapt freely.

```
