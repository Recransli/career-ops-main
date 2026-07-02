#!/usr/bin/env node
/**
 * build-roles.mjs — generates studio/data/roles.json
 *
 * Composes base job titles × seniority variants into a searchable catalog of
 * 1000+ roles, grouped into categories. Each category carries a bank of
 * application-form questions commonly seen for that family of roles, plus a
 * universal set asked on almost every application.
 *
 * Re-run with:  npm run build:roles
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "roles.json");

// Seniority ladders. Tech ICs get the full ladder; other functions a shorter one.
const TECH_LADDER = ["", "Junior ", "Senior ", "Staff ", "Principal ", "Lead "];
const PRO_LADDER = ["", "Junior ", "Senior ", "Lead "];
const SHORT_LADDER = ["", "Senior "];

const UNIVERSAL_QUESTIONS = [
  "Why do you want to work at this company?",
  "Why are you interested in this role?",
  "Tell us about yourself / give a brief introduction.",
  "What are your salary expectations?",
  "What is your notice period / when can you start?",
  "Are you legally authorized to work in this country? Will you now or in the future require visa sponsorship?",
  "Why are you leaving (or why did you leave) your current role?",
  "What is your greatest professional achievement?",
  "Describe a significant challenge you faced at work and how you handled it.",
  "What makes you a strong fit for this position?",
  "Do you have experience working remotely or with distributed teams?",
  "Is there anything else you'd like us to know about your application?",
];

const CATEGORIES = [
  {
    id: "swe",
    label: "Software Engineering",
    ladder: TECH_LADDER,
    bases: [
      "Software Engineer", "Backend Engineer", "Frontend Engineer", "Full Stack Engineer",
      "Web Developer", "Mobile Engineer", "iOS Engineer", "Android Engineer",
      "Flutter Developer", "React Native Developer", "Embedded Software Engineer",
      "Firmware Engineer", "Systems Engineer", "Distributed Systems Engineer",
      "API Engineer", "Game Developer", "Unity Developer", "Unreal Engine Developer",
      "Graphics Engineer", "Blockchain Engineer", "Smart Contract Engineer",
      "Salesforce Developer", "SAP Developer", "ServiceNow Developer",
      "Shopify Developer", "WordPress Developer", "Java Developer", "Python Developer",
      "Go Developer", "Rust Developer", "C++ Developer", ".NET Developer",
      "Node.js Developer", "React Developer", "Angular Developer", "Vue.js Developer",
      "PHP Developer", "Ruby on Rails Developer", "Kotlin Developer", "Swift Developer",
      "Scala Developer", "Elixir Developer", "TypeScript Developer", "Integration Engineer",
    ],
    mgmt: [
      "Engineering Manager", "Software Development Manager", "Director of Engineering",
      "VP of Engineering", "Head of Engineering", "Chief Technology Officer",
    ],
    questions: [
      "Describe a technically challenging project you worked on. What was your specific contribution?",
      "Which programming languages and frameworks are you strongest in, and how have you used them in production?",
      "Tell us about a time you improved the performance, reliability, or scalability of a system.",
      "How do you approach code review and maintaining code quality on a team?",
      "Describe a production incident or difficult bug you debugged. What did you learn?",
      "Tell us about a disagreement over technical direction and how it was resolved.",
      "What is the largest or most complex system you have designed or significantly contributed to?",
    ],
  },
  {
    id: "ml",
    label: "AI / Machine Learning",
    ladder: TECH_LADDER,
    bases: [
      "Machine Learning Engineer", "AI Engineer", "Applied AI Engineer", "MLOps Engineer",
      "Data Scientist", "Applied Scientist", "Research Scientist", "Research Engineer",
      "Deep Learning Engineer", "NLP Engineer", "Computer Vision Engineer", "LLM Engineer",
      "Generative AI Engineer", "AI Agent Engineer", "Prompt Engineer",
      "AI Solutions Architect", "ML Platform Engineer", "AI Safety Researcher",
      "Robotics Engineer", "Speech Recognition Engineer", "Recommendation Systems Engineer",
      "AI Quality Engineer", "ML Infrastructure Engineer",
    ],
    mgmt: [
      "ML Engineering Manager", "Head of AI", "Director of Machine Learning",
      "VP of AI", "Head of Data Science", "Chief AI Officer",
    ],
    questions: [
      "Describe an ML project you took from prototype to production. What was the measurable impact?",
      "Which model families, frameworks, and tooling have you worked with (e.g., PyTorch, transformers, scikit-learn)?",
      "How do you evaluate model quality? Walk us through metrics and experiment design on a past project.",
      "Tell us about a time you had to work with messy, limited, or biased data.",
      "What experience do you have with LLMs or generative AI (fine-tuning, RAG, agents, prompt engineering)?",
      "How do you monitor and maintain models in production (drift detection, retraining, rollback)?",
      "Describe a trade-off you made between model sophistication and business constraints like latency or cost.",
    ],
  },
  {
    id: "data",
    label: "Data & Analytics",
    ladder: TECH_LADDER,
    bases: [
      "Data Engineer", "Data Analyst", "Analytics Engineer", "Business Intelligence Analyst",
      "BI Developer", "Data Architect", "Database Administrator", "ETL Developer",
      "Data Warehouse Engineer", "Big Data Engineer", "Snowflake Developer",
      "Databricks Engineer", "Data Quality Analyst", "Data Governance Analyst",
      "Master Data Analyst", "Product Analyst", "Marketing Analyst",
      "Financial Data Analyst", "Reporting Analyst", "Tableau Developer", "Power BI Developer",
    ],
    mgmt: [
      "Data Engineering Manager", "Analytics Manager", "Director of Data",
      "Head of Data", "VP of Data", "Chief Data Officer",
    ],
    questions: [
      "Describe a data pipeline or data model you built. What tools did you use and what problem did it solve?",
      "How deep is your SQL? Describe the most complex analysis or transformation you've written.",
      "Tell us about a data quality issue you discovered and how you fixed it upstream.",
      "Which parts of the modern data stack have you used (dbt, Airflow, Spark, warehouse platforms)?",
      "Describe an insight from your analysis that changed a business decision.",
      "How do you make dashboards and reports that stakeholders actually use?",
      "Tell us about balancing ad-hoc stakeholder requests against long-term data infrastructure work.",
    ],
  },
  {
    id: "devops",
    label: "DevOps / Cloud / Infrastructure",
    ladder: TECH_LADDER,
    bases: [
      "DevOps Engineer", "Site Reliability Engineer", "Platform Engineer", "Cloud Engineer",
      "Infrastructure Engineer", "Cloud Architect", "AWS Cloud Engineer", "Azure Engineer",
      "GCP Engineer", "Kubernetes Engineer", "CI/CD Engineer", "Release Engineer",
      "Build Engineer", "Systems Administrator", "Linux Administrator", "Network Engineer",
      "FinOps Analyst", "Observability Engineer", "Automation Engineer", "IT Infrastructure Engineer",
    ],
    mgmt: [
      "DevOps Manager", "Director of Infrastructure", "Head of Platform", "VP of Infrastructure",
    ],
    questions: [
      "Describe the scale of infrastructure you've managed (services, clusters, regions, users).",
      "What is your experience with infrastructure as code (Terraform, Pulumi, CloudFormation)?",
      "Tell us about a major incident you handled on-call. What was the root cause and the follow-up?",
      "How have you improved a CI/CD pipeline — build times, reliability, or deployment safety?",
      "Describe a cloud cost optimization you drove and its measurable savings.",
      "Tell us about a migration you led (to cloud, to Kubernetes, between providers).",
      "How do you approach SLOs, monitoring, and alerting so teams aren't drowning in noise?",
    ],
  },
  {
    id: "security",
    label: "Security",
    ladder: TECH_LADDER,
    bases: [
      "Security Engineer", "Application Security Engineer", "Cybersecurity Analyst",
      "SOC Analyst", "Penetration Tester", "Red Team Operator", "Threat Intelligence Analyst",
      "Incident Response Analyst", "Security Architect", "Cloud Security Engineer",
      "GRC Analyst", "IAM Engineer", "Vulnerability Management Analyst",
      "Detection Engineer", "Security Operations Engineer", "DevSecOps Engineer",
      "Malware Analyst", "Digital Forensics Analyst",
    ],
    mgmt: [
      "Security Manager", "Director of Security", "Head of Security", "Chief Information Security Officer",
    ],
    questions: [
      "Describe a security incident you responded to. What was your role and what changed afterward?",
      "How do you approach threat modeling for a new system or feature?",
      "Which compliance frameworks have you worked with (SOC 2, ISO 27001, HIPAA, PCI-DSS)?",
      "Tell us about a significant vulnerability you found and how you got it remediated.",
      "How do you embed security into the development lifecycle without blocking engineering velocity?",
      "Which security tooling have you operated (SIEM, EDR, scanners, WAF)?",
      "Describe explaining a technical risk to non-technical leadership and the decision it informed.",
    ],
  },
  {
    id: "qa",
    label: "QA / Testing",
    ladder: TECH_LADDER,
    bases: [
      "QA Engineer", "QA Analyst", "Software Development Engineer in Test",
      "Test Automation Engineer", "Manual QA Tester", "Performance Test Engineer",
      "QA Automation Architect", "Mobile QA Engineer", "Game Tester",
    ],
    mgmt: ["QA Manager", "Director of Quality", "Head of QA"],
    questions: [
      "How do you design a test strategy for a new feature or product?",
      "Which automation frameworks and tools have you used (Playwright, Cypress, Selenium, Appium)?",
      "Tell us about a critical bug you caught before release and its potential impact.",
      "How have you integrated testing into CI/CD pipelines?",
      "What experience do you have with performance or load testing?",
      "How do you balance test coverage against release speed?",
    ],
  },
  {
    id: "product",
    label: "Product Management",
    ladder: ["", "Associate ", "Senior ", "Lead ", "Principal "],
    bases: [
      "Product Manager", "Technical Product Manager", "Product Owner",
      "Growth Product Manager", "Platform Product Manager", "Data Product Manager",
      "AI Product Manager", "Mobile Product Manager", "Payments Product Manager",
      "Product Operations Manager",
    ],
    mgmt: [
      "Group Product Manager", "Director of Product", "Head of Product",
      "VP of Product", "Chief Product Officer",
    ],
    questions: [
      "Describe a product or feature you shipped end-to-end. What metrics did it move?",
      "How do you prioritize a backlog? Walk us through a real prioritization decision.",
      "Tell us about a time you said no to an important stakeholder.",
      "How do you run discovery — talking to users, validating problems before building?",
      "Describe a launch that failed or underperformed. What did you learn?",
      "How do you work with engineering and design to keep delivery on track?",
      "How do you define and instrument success metrics for a new feature?",
    ],
  },
  {
    id: "design",
    label: "Design & UX",
    ladder: PRO_LADDER,
    bases: [
      "Product Designer", "UX Designer", "UI Designer", "UX Researcher",
      "Interaction Designer", "Visual Designer", "Graphic Designer", "Brand Designer",
      "Motion Designer", "Design Systems Designer", "Service Designer", "Content Designer",
      "UX Writer", "Web Designer", "Illustrator", "3D Artist", "Creative Technologist",
    ],
    mgmt: [
      "Design Manager", "Creative Director", "Director of Design", "Head of Design", "VP of Design",
    ],
    questions: [
      "Please share a link to your portfolio.",
      "Walk us through one case study: the problem, your process, and the outcome.",
      "How do you use research to inform design decisions? Give a concrete example.",
      "What experience do you have building or contributing to a design system?",
      "Tell us about receiving hard critique or stakeholder pushback on a design.",
      "How do you design for accessibility?",
      "How do you measure whether a design actually worked?",
    ],
  },
  {
    id: "marketing",
    label: "Marketing & Growth",
    ladder: PRO_LADDER,
    bases: [
      "Marketing Manager", "Digital Marketing Manager", "Content Marketing Manager",
      "Product Marketing Manager", "Growth Marketer", "SEO Specialist", "SEM Specialist",
      "Paid Media Specialist", "Performance Marketing Manager", "Social Media Manager",
      "Community Manager", "Email Marketing Specialist", "CRM Manager", "Brand Manager",
      "Marketing Operations Manager", "Demand Generation Manager", "Field Marketing Manager",
      "Influencer Marketing Manager", "Copywriter", "Content Strategist",
    ],
    mgmt: ["Director of Marketing", "Head of Marketing", "VP of Marketing", "Chief Marketing Officer"],
    questions: [
      "Describe a campaign you ran and its results (CAC, ROAS, conversion, pipeline).",
      "Which channels are you strongest in, and how do you decide channel mix?",
      "Share an example of content or copy you created that performed well.",
      "Which marketing tools and platforms have you used (HubSpot, GA4, Marketo, ad platforms)?",
      "Tell us about managing a marketing budget and how you allocated it.",
      "Describe a growth experiment you designed — hypothesis, execution, result.",
      "How do you balance brand building with performance marketing?",
    ],
  },
  {
    id: "sales",
    label: "Sales & Customer Success",
    ladder: PRO_LADDER,
    bases: [
      "Sales Development Representative", "Business Development Representative",
      "Account Executive", "Enterprise Account Executive", "Account Manager",
      "Key Account Manager", "Sales Engineer", "Solutions Engineer", "Solutions Consultant",
      "Solutions Architect", "Pre-Sales Consultant", "Customer Success Manager",
      "Customer Success Engineer", "Onboarding Specialist", "Implementation Consultant",
      "Partnerships Manager", "Channel Sales Manager", "Business Development Manager",
      "Revenue Operations Analyst", "Sales Operations Analyst",
    ],
    mgmt: [
      "Sales Manager", "Regional Sales Director", "Head of Sales", "VP of Sales", "Chief Revenue Officer",
    ],
    questions: [
      "What has your quota attainment looked like over the past few years?",
      "Tell us about a deal you're proud of — size, cycle length, and how you won it.",
      "How do you approach prospecting and building pipeline in a new territory?",
      "Describe handling a difficult objection or saving a deal that was going sideways.",
      "Which CRM and sales tools do you use day-to-day?",
      "Tell us about a deal or customer you lost and what you took from it.",
      "How do you manage and grow existing accounts (expansion, renewal, churn prevention)?",
    ],
  },
  {
    id: "finance",
    label: "Finance & Accounting",
    ladder: SHORT_LADDER,
    bases: [
      "Financial Analyst", "FP&A Analyst", "Accountant", "Staff Accountant",
      "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist",
      "Financial Controller", "Auditor", "Internal Auditor", "Tax Analyst", "Treasury Analyst",
      "Investment Analyst", "Equity Research Analyst", "Risk Analyst", "Credit Analyst",
      "Actuary", "Bookkeeper", "Billing Specialist", "Procurement Analyst",
    ],
    mgmt: [
      "Finance Manager", "Accounting Manager", "Director of Finance", "Head of Finance",
      "VP of Finance", "Chief Financial Officer",
    ],
    questions: [
      "Describe a financial model or analysis you built and the decision it supported.",
      "Which finance systems and tools have you used (ERP, Excel depth, SQL, BI tools)?",
      "What is your experience with month-end / quarter-end close?",
      "Tell us about a variance you investigated and what you found.",
      "What exposure do you have to audit, SOX, or regulatory compliance?",
      "Do you hold or are you pursuing certifications (CPA, CFA, ACCA)?",
      "Describe a finance process you improved or automated.",
    ],
  },
  {
    id: "hr",
    label: "HR / People / Recruiting",
    ladder: SHORT_LADDER,
    bases: [
      "Recruiter", "Technical Recruiter", "Talent Acquisition Specialist", "Talent Sourcer",
      "HR Generalist", "HR Business Partner", "People Operations Specialist",
      "Compensation and Benefits Analyst", "HRIS Analyst", "Learning and Development Specialist",
      "Employee Relations Specialist", "Diversity and Inclusion Specialist",
      "Workplace Experience Coordinator",
    ],
    mgmt: [
      "HR Manager", "Talent Acquisition Manager", "Director of People", "Head of People",
      "VP of People", "Chief People Officer",
    ],
    questions: [
      "What roles and hiring volumes have you owned end-to-end?",
      "Describe your sourcing strategy for a hard-to-fill role.",
      "Tell us about a sensitive employee relations case you handled (keeping confidentiality).",
      "Which ATS/HRIS platforms have you used?",
      "What people-metrics do you track (time-to-fill, retention, offer acceptance)?",
      "Describe a program you built (onboarding, L&D, DEI) and its impact.",
    ],
  },
  {
    id: "ops",
    label: "Operations & Program Management",
    ladder: SHORT_LADDER,
    bases: [
      "Project Manager", "Technical Program Manager", "Program Manager", "Scrum Master",
      "Agile Coach", "Delivery Manager", "Business Analyst", "Operations Analyst",
      "Business Operations Manager", "Strategy and Operations Manager", "Supply Chain Analyst",
      "Logistics Coordinator", "Procurement Specialist", "Inventory Analyst",
      "Facilities Manager", "Executive Assistant", "Office Manager", "Chief of Staff",
    ],
    mgmt: [
      "Operations Manager", "Director of Operations", "Head of Operations",
      "VP of Operations", "Chief Operating Officer",
    ],
    questions: [
      "Describe a program you ran with many stakeholders. How did you keep it on track?",
      "Which delivery methodologies do you use (Agile, Scrum, Kanban, waterfall) and when?",
      "Tell us about surfacing and escalating a risk before it became a crisis.",
      "Describe a process you improved and the measurable result.",
      "Which tools do you run programs with (Jira, Asana, Notion, spreadsheets)?",
      "How do you handle competing priorities across teams with limited resources?",
    ],
  },
  {
    id: "it",
    label: "IT & Support",
    ladder: SHORT_LADDER,
    bases: [
      "IT Support Specialist", "Help Desk Technician", "Desktop Support Engineer",
      "IT Administrator", "Technical Support Engineer", "Customer Support Specialist",
      "Customer Support Engineer", "Application Support Analyst", "IT Business Analyst",
      "ERP Administrator", "CRM Administrator", "Salesforce Administrator", "IT Asset Manager",
    ],
    mgmt: ["IT Manager", "Director of IT", "Head of IT", "Chief Information Officer"],
    questions: [
      "What environments have you supported (number of users, platforms, systems)?",
      "How do you manage ticket queues and SLAs?",
      "Walk us through your troubleshooting methodology for an issue you've never seen.",
      "Describe a migration or upgrade project you executed.",
      "Which certifications do you hold (CompTIA, Microsoft, Cisco, ITIL)?",
      "How do you document solutions so problems get fixed once?",
    ],
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    ladder: SHORT_LADDER,
    bases: [
      "Legal Counsel", "Corporate Counsel", "Paralegal", "Contracts Manager",
      "Compliance Officer", "Privacy Counsel", "Data Protection Officer",
      "Regulatory Affairs Specialist", "IP Counsel",
    ],
    mgmt: ["General Counsel", "Head of Legal", "Director of Compliance"],
    questions: [
      "Which practice areas and jurisdictions have you worked in?",
      "Describe your experience negotiating and managing commercial contracts.",
      "Tell us about building or operating a compliance program.",
      "Describe advising a business team through a legally sensitive decision.",
      "How do you track and respond to regulatory changes affecting the business?",
      "What are your qualifications (bar admissions, certifications)?",
    ],
  },
  {
    id: "content",
    label: "Content & Communications",
    ladder: SHORT_LADDER,
    bases: [
      "Technical Writer", "Documentation Engineer", "Content Writer", "Editor",
      "Journalist", "Communications Manager", "PR Manager", "Internal Communications Manager",
      "Grant Writer", "Localization Specialist", "Translator", "Podcast Producer",
      "Video Editor", "Developer Advocate", "Developer Relations Engineer",
    ],
    mgmt: ["Content Manager", "Director of Communications", "Head of Content"],
    questions: [
      "Please share writing samples or a portfolio relevant to this role.",
      "Describe adapting the same material for two very different audiences.",
      "Which authoring and publishing tools do you work with (docs-as-code, CMS, style tooling)?",
      "How do you collaborate with subject-matter experts to extract accurate content?",
      "What editorial processes or style guides have you worked within or created?",
      "How do you measure whether your content is effective?",
    ],
  },
];

const roles = [];
const seen = new Set();
function push(title, cat) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (seen.has(id)) return;
  seen.add(id);
  roles.push({ id, t: title, c: cat });
}

for (const cat of CATEGORIES) {
  for (const base of cat.bases) for (const pre of cat.ladder) push(pre + base, cat.id);
  for (const m of cat.mgmt) push(m, cat.id);
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  universalQuestions: UNIVERSAL_QUESTIONS,
  categories: Object.fromEntries(
    CATEGORIES.map((c) => [c.id, { label: c.label, questions: c.questions }])
  ),
  roles,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${roles.length} roles across ${CATEGORIES.length} categories → ${OUT}`);
